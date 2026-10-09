import test from "node:test";
import assert from "node:assert/strict";
import { Poker, getBank, setBank } from "../extensions/blackjack.ts";

test("poker reloads bank to 100 if player is broke", () => {
  setBank(0);
  const poker = new Poker(() => {});
  // Deal consumes 10 ante, so bank should be 90
  assert.equal(getBank(), 90);
  poker.abandon();
});

test("all-in line display does not show call amount when bank is 0", () => {
  setBank(10);
  const poker = new Poker(() => {});
  // Bank was 10, ante took 10, bank is now 0 (all-in)
  assert.equal(getBank(), 0);
  const lines = poker.lines();
  // Header should show bank 0, but NOT "call N"
  const header = lines[0];
  assert.ok(header.includes("bank 0"));
  assert.ok(!header.includes("call "));
  // "you" line should display all-in status
  const youLine = lines.find(l => l.includes("you"));
  assert.ok(youLine && youLine.includes("all-in"));
  poker.abandon();
});

test("poker action note shows (all-in) when call exceeds bank", () => {
  setBank(25);
  const poker = new Poker(() => {});
  // After ante 10, bank is 15
  assert.equal(getBank(), 15);
  const anyPoker = poker as any;
  const note = anyPoker.actionNote(30);
  assert.ok(note.includes("call 15 (all-in)"));
  poker.abandon();
});

test("pushChips with 0 paid does not get stuck on 'no chips'", (t, done) => {
  setBank(10);
  const poker = new Poker(() => {});
  // Bank is now 0
  const anyPoker = poker as any;
  anyPoker.yourTurn = true;
  anyPoker.pushChips(0, true);
  // yourTurn should be set to false and note should be all-in, not freezing on "no chips"
  assert.equal(anyPoker.yourTurn, false);
  assert.equal(anyPoker.note, "all-in");
  poker.abandon();
  done();
});

test("canAct correctly identifies eligible players with chips", () => {
  setBank(0);
  const poker = new Poker(() => {});
  const anyPoker = poker as any;
  setBank(0);
  assert.equal(anyPoker.canAct("you"), false);
  setBank(50);
  assert.equal(anyPoker.canAct("you"), true);
  anyPoker.youFolded = true;
  assert.equal(anyPoker.canAct("you"), false);
  poker.abandon();
});

test("behind(actor) excludes all-in player (bank === 0)", () => {
  setBank(50);
  const poker = new Poker(() => {});
  const anyPoker = poker as any;
  // Put player all in
  setBank(0);
  // Behind bot 0 should NOT include "you"
  const behind0 = anyPoker.behind(0);
  assert.ok(!behind0.includes("you"), "behind(0) should not include 'you' when bank === 0");
  poker.abandon();
});

test("beginStreet sets pending to empty if at most 1 player has chips", () => {
  setBank(50);
  const poker = new Poker(() => {});
  const anyPoker = poker as any;
  setBank(0); // player is all-in
  // Fold 2 bots, leave 1 bot with chips
  anyPoker.bots[1].folded = true;
  anyPoker.bots[2].folded = true;
  anyPoker.bots[0].stack = 40;
  anyPoker.beginStreet("test street");
  // Only bot 0 has chips, so pending must be empty (cannot bet against nobody)
  assert.equal(anyPoker.pending.length, 0);
  poker.abandon();
});

test("user exact scenario: all-in player on river never gets stuck on call", () => {
  setBank(50);
  const poker = new Poker(() => {});
  const anyPoker = poker as any;
  anyPoker.street = "river";
  anyPoker.shownBoard = 5;
  setBank(0); // user went all-in
  anyPoker.youStreet = 30;
  anyPoker.streetBet = 60; // Sol raised to 60
  anyPoker.bots[1].folded = true; // Pax folded
  anyPoker.bots[2].folded = true; // Jun folded

  // Behind Sol (index 0) should have NO players who can act
  const behindSol = anyPoker.behind(0);
  assert.equal(behindSol.length, 0, "No players can act behind Sol");

  // If next is 'you' in step(), step() should immediately skip 'you' because bank === 0
  anyPoker.pending = ["you"];
  anyPoker.step();
  // yourTurn should NOT be true
  assert.equal(anyPoker.yourTurn, false);
  // Hand should have advanced to showdown / done!
  assert.equal(anyPoker.street, "done");
  poker.abandon();
});
