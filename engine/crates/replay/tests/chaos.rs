//! Failure injection: kill switch from another thread, venue disconnect, stale
//! book, partial fills, and an order the process never sent.

use std::thread;
use std::time::{Duration, Instant};

use qc_core::{ClientOrderId, Price, Qty, Side};
use qc_gateway::{Record, SimVenue, record};
use qc_oms::OrderState;
use qc_replay::{Engine, HaltReason, sample_engine};
use qc_risk::{KillSwitch, Limits};
use qc_strategy_runtime::InsideQuoter;

type Sample = Engine<InsideQuoter, SimVenue>;

fn limits() -> Limits {
    toml::from_str(include_str!("../../../../config/limits/default.toml")).unwrap()
}

fn feed(engine: &mut Sample, records: &[Record]) {
    for r in records {
        engine.venue_mut().on_record(r);
        engine.on_record(r);
    }
}

fn parse(text: &str) -> Vec<Record> {
    record::parse(text).unwrap()
}

const MS: u64 = 1_000_000;

/// Book at bid 100.0 / ask 100.2, sequence 10, at `t` ms.
fn open_book(t: u64) -> Vec<Record> {
    let ns = t * MS;
    parse(&format!("S,1,10,{ns},{ns},100.0@1;99.9@1,100.2@1;100.3@1"))
}

/// A bid appears at 100.1 or disappears again: the quoter's bid moves each time.
fn flicker(i: u64) -> Record {
    let ns = 1000 * MS + i * 250 * MS;
    let qty = if i % 2 == 0 { "1" } else { "0" };
    parse(&format!("D,1,{},B,100.1,{qty},{ns},{ns}", 11 + i)).remove(0)
}

#[test]
fn kill_switch_from_another_thread_halts_within_one_second() {
    let kill = KillSwitch::new();
    let remote = kill.clone();
    let mut engine = sample_engine(limits(), kill);
    feed(&mut engine, &open_book(0));

    let flip_thread = thread::spawn(move || {
        thread::sleep(Duration::from_millis(50));
        let flipped = Instant::now();
        remote.engage();
        flipped
    });

    let started = Instant::now();
    let mut i = 0;
    let (observed, submitted_at_halt) = loop {
        feed(&mut engine, &[flicker(i)]);
        i += 1;
        if engine.halted().is_some() {
            break (Instant::now(), engine.submitted());
        }
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "kill switch never observed"
        );
    };
    let flipped = flip_thread.join().unwrap();

    let latency = observed.duration_since(flipped);
    println!("kill switch observed {latency:?} after it was engaged ({i} records replayed)");
    assert!(latency < Duration::from_secs(1));
    assert_eq!(engine.halted(), Some(HaltReason::KillSwitch));
    assert!(submitted_at_halt > 2, "orders were flowing before the flip");

    // Keep feeding: nothing more may be submitted, and every order is being canceled.
    for j in i..i + 1000 {
        feed(&mut engine, &[flicker(j)]);
    }
    assert_eq!(engine.submitted(), submitted_at_halt);
    let after_halt = engine.log().split_once(" halt KillSwitch").unwrap().1;
    assert!(
        !after_halt.contains(" submit "),
        "submit after halt:\n{after_halt}"
    );
    assert_eq!(engine.oms().open_orders().count(), 0);
}

#[test]
fn disconnect_rejects_new_orders_locally_and_trading_resumes_after_reconnect() {
    let mut engine = sample_engine(limits(), KillSwitch::new());
    feed(&mut engine, &open_book(0));
    feed(&mut engine, &[flicker(0)]);
    let before = engine.submitted();
    assert!(before > 0);

    engine.venue_mut().set_connected(false);
    for i in 1..5 {
        feed(&mut engine, &[flicker(i)]);
    }
    assert_eq!(
        engine.submitted(),
        before,
        "nothing reaches a disconnected venue"
    );
    assert!(engine.log().contains("cancel-failed"), "{}", engine.log());
    assert!(
        engine
            .oms()
            .open_orders()
            .all(|o| o.state != OrderState::PendingNew),
        "a failed submit must not leave an order pending"
    );

    engine.venue_mut().set_connected(true);
    for i in 5..10 {
        feed(&mut engine, &[flicker(i)]);
    }
    assert!(
        engine.submitted() > before,
        "trading resumes after reconnect"
    );
    engine.reconcile();
    assert_eq!(engine.halted(), None, "{}", engine.log());
}

#[test]
fn stale_book_blocks_new_orders_until_fresh_data_arrives() {
    let mut engine = sample_engine(limits(), KillSwitch::new());
    feed(&mut engine, &open_book(0));
    // First market event places quotes; a sell trade 1.5 s later fills the bid,
    // then another trade asks the quoter to replace it on a book that is now stale.
    feed(
        &mut engine,
        &parse(&format!(
            "T,1,B,100.2,0.0001,{a},{a}\nT,1,S,100.0,0.001,{b},{b}\nT,1,S,100.0,0.0001,{c},{c}",
            a = 10 * MS,
            b = 1500 * MS,
            c = 1600 * MS
        )),
    );
    assert!(engine.log().contains("StaleData"), "{}", engine.log());
    let submitted = engine.submitted();
    feed(
        &mut engine,
        &parse(&format!("D,1,11,B,99.8,1,{t},{t}", t = 1700 * MS)),
    );
    assert_eq!(
        engine.submitted(),
        submitted + 1,
        "fresh data unblocks the bid"
    );
}

#[test]
fn partial_fills_accumulate_without_overfilling() {
    let mut engine = sample_engine(limits(), KillSwitch::new());
    feed(&mut engine, &open_book(0));
    let t = |ms: u64| ms * MS;
    feed(
        &mut engine,
        &parse(&format!(
            "T,1,B,100.2,0.0001,{},{}\nT,1,S,100.0,0.0004,{},{}",
            t(10),
            t(10),
            t(20),
            t(20)
        )),
    );
    let bid = engine.oms().get(ClientOrderId(1)).unwrap();
    assert_eq!(
        (bid.request.side, bid.state),
        (Side::Buy, OrderState::PartiallyFilled)
    );
    assert_eq!(engine.position(), "0.0004".parse::<Qty>().unwrap());

    feed(
        &mut engine,
        &parse(&format!("T,1,S,100.0,0.5,{},{}", t(30), t(30))),
    );
    assert_eq!(
        engine.oms().get(ClientOrderId(1)).unwrap().state,
        OrderState::Filled
    );
    assert_eq!(engine.position(), "0.001".parse::<Qty>().unwrap());
    assert!(!engine.log().contains("Overfill"));
}

#[test]
fn unknown_order_at_the_venue_halts_and_cancels_everything() {
    let mut engine = sample_engine(limits(), KillSwitch::new());
    feed(&mut engine, &open_book(0));
    feed(&mut engine, &[flicker(0)]);
    engine
        .venue_mut()
        .inject_foreign_order(Side::Buy, Price::from_raw(1), Qty::from_raw(1));
    engine.reconcile();
    assert_eq!(engine.halted(), Some(HaltReason::Reconciliation));
    let submitted = engine.submitted();
    feed(&mut engine, &[flicker(1), flicker(2)]);
    assert_eq!(engine.submitted(), submitted);
    assert_eq!(engine.oms().open_orders().count(), 0);
}

fn open_at_venue(venue: &SimVenue) -> usize {
    venue.orders().iter().filter(|o| o.open).count()
}

#[test]
fn kill_switch_during_a_disconnect_cancels_every_order_once_the_venue_is_back() {
    let kill = KillSwitch::new();
    let mut engine = sample_engine(limits(), kill.clone());
    feed(&mut engine, &open_book(0));
    feed(&mut engine, &[flicker(0)]);
    assert!(open_at_venue(engine.venue_mut()) > 0, "quotes rest");

    engine.venue_mut().set_connected(false);
    kill.engage();
    feed(&mut engine, &[flicker(1), flicker(2)]);
    assert_eq!(engine.halted(), Some(HaltReason::KillSwitch));
    let log = engine.log().to_owned();
    assert!(log.contains("cancel-failed"), "{log}");
    let after_halt = log.split_once(" halt KillSwitch").unwrap().1;
    assert!(
        !after_halt
            .lines()
            .any(|l| l.split(' ').nth(1) == Some("cancel")),
        "a cancel the venue never received is logged as sent:\n{after_halt}"
    );

    engine.venue_mut().set_connected(true);
    feed(&mut engine, &[flicker(3), flicker(4)]);
    assert_eq!(open_at_venue(engine.venue_mut()), 0, "{}", engine.log());
    assert_eq!(engine.oms().open_orders().count(), 0);
}
