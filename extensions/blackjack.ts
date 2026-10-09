import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";

const SUITS = ["♠", "♥", "♦", "♣"] as const;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
const LAVENDER = "\x1b[38;2;184;168;240m";
const ROSE = "\x1b[38;2;226;140;150m";
const MUTED = "\x1b[38;2;154;146;134m";
const INK = "\x1b[38;2;236;230;220m";
const BG = "\x1b[48;2;22;20;28m";
const RESET = "\x1b[0m";

type Card = { rank: (typeof RANKS)[number]; suit: (typeof SUITS)[number] };
type GameName = "blackjack" | "poker";

let bank = 100;

export function getBank(): number { return bank; }
export function setBank(val: number): void { bank = val; }

function shoe(): Card[] {
  const cards = SUITS.flatMap(suit => RANKS.map(rank => ({ rank, suit })));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function value(hand: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.rank === "A") { total += 11; aces++; }
    else if (card.rank === "J" || card.rank === "Q" || card.rank === "K") total += 10;
    else total += Number(card.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function rankValue(rank: Card["rank"]): number {
  if (rank === "A") return 14;
  if (rank === "K") return 13;
  if (rank === "Q") return 12;
  if (rank === "J") return 11;
  return Number(rank);
}

function fiveScore(cards: Card[]): { name: string; score: number } {
  const vals = cards.map(card => rankValue(card.rank)).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const kick = groups.flatMap(([v, n]) => Array(n).fill(v));
  const flush = new Set(cards.map(card => card.suit)).size === 1;
  const unique = [...new Set(vals)].sort((a, b) => a - b);
  const wheel = unique.join() === "2,3,4,5,14";
  const straightHigh = wheel ? 5 : unique.length === 5 && unique[4] - unique[0] === 4 ? unique[4] : 0;
  const pack = (cat: number, parts: number[]) => cat * 1e10 + parts.reduce((sum, v, i) => sum + v * 15 ** (5 - i), 0);
  if (straightHigh && flush && straightHigh === 14) return { name: "royal flush", score: pack(9, [14]) };
  if (straightHigh && flush) return { name: "straight flush", score: pack(8, [straightHigh]) };
  if (groups[0][1] === 4) return { name: "four of a kind", score: pack(7, kick) };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { name: "full house", score: pack(6, kick) };
  if (flush) return { name: "flush", score: pack(5, vals) };
  if (straightHigh) return { name: "straight", score: pack(4, [straightHigh]) };
  if (groups[0][1] === 3) return { name: "three of a kind", score: pack(3, kick) };
  if (groups[0][1] === 2 && groups[1][1] === 2) return { name: "two pair", score: pack(2, kick) };
  if (groups[0][1] === 2) return { name: "pair", score: pack(1, kick) };
  return { name: "high card", score: pack(0, vals) };
}

function bestHand(cards: Card[]): { name: string; score: number } {
  const pick = (rest: Card[], need: number): Card[][] => {
    if (need === 0) return [[]];
    if (rest.length < need) return [];
    const [head, ...tail] = rest;
    return pick(tail, need - 1).map(set => [head, ...set]).concat(pick(tail, need));
  };
  return pick(cards, 5).reduce((best, five) => {
    const scored = fiveScore(five);
    return scored.score > best.score ? scored : best;
  }, { name: "high card", score: -1 });
}

function paint(card: Card): string {
  const red = card.suit === "♥" || card.suit === "♦";
  return `${BG}${red ? ROSE : LAVENDER}${card.rank}${card.suit}\x1b[39m`;
}

function panel(width: number, inner: string[]): string[] {
  const innerWidth = Math.max(24, width - 2);
  const rule = "─".repeat(innerWidth);
  const top = `${LAVENDER}${BG}╭${rule}╮${RESET}`;
  const bottom = `${LAVENDER}${BG}╰${rule}╯${RESET}`;
  const body = inner.map(line => {
    const pad = Math.max(0, innerWidth - 2 - visibleWidth(line));
    return `${LAVENDER}${BG}│${RESET}${BG} ${line}${BG}${" ".repeat(pad)} ${LAVENDER}│${RESET}`;
  });
  return [top, ...body, bottom];
}

function takeBet(bet: number): number {
  const stake = Math.min(bet, bank);
  bank -= stake;
  return stake;
}

class Blackjack {
  private deck: Card[] = [];
  private dealer: Card[] = [];
  private hands: Card[][] = [];
  private bets: number[] = [];
  private active = 0;
  private shownYou = 0;
  private shownDealer = 0;
  private holeHidden = true;
  private insured = false;
  private insurance = 0;
  private phase: "deal" | "play" | "busy" | "done" = "deal";
  private note = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private render: () => void;

  constructor(render: () => void) {
    this.render = render;
    this.deal();
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private run(steps: Array<() => void>, done: () => void): void {
    const next = () => {
      const step = steps.shift();
      if (!step) { done(); return; }
      step();
      this.timer = setTimeout(() => { this.timer = undefined; next(); }, 340);
      this.render();
    };
    this.stop();
    next();
  }

  private hand(): Card[] { return this.hands[this.active] ?? []; }

  private sameRank(hand: Card[]): boolean {
    return hand.length === 2 && (hand[0].rank === hand[1].rank || (value([hand[0]]) === 10 && value([hand[1]]) === 10));
  }

  private prompt(): string {
    const hand = this.hand();
    const bet = this.bets[this.active] ?? 0;
    const parts = ["h hit", "s stand"];
    if (hand.length === 2 && bank >= bet) parts.push("d double");
    if (hand.length === 2 && this.hands.length === 1 && this.sameRank(hand) && bank >= bet) parts.push("p split");
    if (hand.length === 2 && this.hands.length === 1) parts.push("u surrender");
    if (!this.insured && this.dealer[0]?.rank === "A" && hand.length === 2 && bank >= Math.floor(bet / 2)) parts.push("i insurance");
    if (value(hand) === 21 && this.dealer[0]?.rank === "A" && this.hands.length === 1) parts.push("e even");
    return parts.join("   ");
  }

  private deal(): void {
    this.stop();
    if (bank === 0) bank = 100;
    const stake = takeBet(10);
    this.shownYou = 0;
    this.shownDealer = 0;
    this.holeHidden = true;
    this.insured = false;
    this.insurance = 0;
    this.active = 0;
    this.hands = [];
    this.bets = [];
    this.dealer = [];
    if (stake === 0) { this.phase = "done"; this.note = "broke. q close"; this.render(); return; }
    this.deck = shoe();
    this.hands = [[this.deck.pop()!, this.deck.pop()!]];
    this.bets = [stake];
    this.dealer = [this.deck.pop()!, this.deck.pop()!];
    this.phase = "deal";
    this.note = "dealing";
    this.run([
      () => { this.shownYou = 1; },
      () => { this.shownDealer = 1; },
      () => { this.shownYou = 2; },
      () => { this.shownDealer = 2; },
    ], () => {
      if (value(this.hand()) === 21 && this.dealer[0].rank !== "A") this.finish(true);
      else { this.phase = "play"; this.note = this.prompt(); this.render(); }
    });
  }

  private nextHand(): void {
    this.active += 1;
    if (this.active < this.hands.length) {
      this.phase = "play";
      this.note = `hand ${this.active + 1}. ${this.prompt()}`;
      this.render();
      return;
    }
    this.finish();
  }

  private payInsurance(): void {
    if (!this.insured) return;
    if (value(this.dealer) === 21) bank += this.insurance * 3;
    this.insured = false;
  }

  private settle(): void {
    this.payInsurance();
    const d = value(this.dealer);
    const notes: string[] = [];
    this.hands.forEach((hand, i) => {
      const bet = this.bets[i];
      const p = value(hand);
      if (p > 21) notes.push(`h${i + 1} bust`);
      else if (d > 21 || p > d) { bank += bet * 2; notes.push(`h${i + 1} +${bet}`); }
      else if (p === d) { bank += bet; notes.push(`h${i + 1} push`); }
      else notes.push(`h${i + 1} lose`);
    });
    this.phase = "done";
    this.note = `${notes.join("  ")}. n again`;
    this.render();
  }

  private finish(playerBlackjack = false): void {
    this.phase = "busy";
    if (playerBlackjack && value(this.dealer) !== 21) {
      this.run([() => { this.holeHidden = false; this.note = "dealer shows"; }], () => {
        bank += this.bets[0] + Math.floor(this.bets[0] * 1.5);
        this.phase = "done";
        this.note = `blackjack +${this.bets[0] + Math.floor(this.bets[0] * 1.5)}. n again`;
        this.render();
      });
      return;
    }
    const incoming: Card[] = [];
    const virtual = [...this.dealer];
    const everyBust = this.hands.every(hand => value(hand) > 21);
    if (!everyBust) {
      while (value(virtual) < 17) {
        const card = this.deck.pop()!;
        incoming.push(card);
        virtual.push(card);
      }
    }
    this.run([
      () => { this.holeHidden = false; this.note = "dealer shows"; },
      ...incoming.map(card => () => {
        this.dealer.push(card);
        this.shownDealer = this.dealer.length;
        this.note = "dealer draws";
      }),
    ], () => this.settle());
  }

  abandon(): void {
    this.stop();
    if (this.phase !== "done") bank += this.bets.reduce((sum, bet) => sum + bet, 0) + this.insurance;
  }

  input(data: string): void {
    if (matchesKey(data, "n") && this.phase === "done") { this.deal(); return; }
    if (this.phase !== "play") return;
    const hand = this.hand();
    const bet = this.bets[this.active] ?? 0;
    if (matchesKey(data, "h")) {
      if (hand.length === 2 && hand[0].rank === "A" && hand[1].rank === "A" && this.hands.length > 1) return;
      const card = this.deck.pop()!;
      this.phase = "busy";
      this.note = "you draw";
      this.run([() => { hand.push(card); this.shownYou = hand.length; }], () => {
        if (value(hand) >= 21) this.nextHand();
        else { this.phase = "play"; this.note = this.prompt(); this.render(); }
      });
      return;
    }
    if (matchesKey(data, "s")) { this.nextHand(); return; }
    if (matchesKey(data, "d") && hand.length === 2 && bank >= bet) {
      const extra = takeBet(bet);
      this.bets[this.active] += extra;
      const card = this.deck.pop()!;
      this.phase = "busy";
      this.note = "double";
      this.run([() => { hand.push(card); this.shownYou = hand.length; }], () => this.nextHand());
      return;
    }
    if (matchesKey(data, "p") && hand.length === 2 && this.hands.length === 1 && this.sameRank(hand) && bank >= bet) {
      const extra = takeBet(bet);
      const left = hand[0];
      const right = hand[1];
      const a = this.deck.pop()!;
      const b = this.deck.pop()!;
      this.hands = [[left, a], [right, b]];
      this.bets = [bet, extra];
      this.active = 0;
      this.phase = "busy";
      this.note = "split";
      this.run([
        () => { this.shownYou = 2; },
      ], () => {
        if (left.rank === "A") { this.active = 1; this.finish(); }
        else { this.phase = "play"; this.note = this.prompt(); this.render(); }
      });
      return;
    }
    if (matchesKey(data, "u") && hand.length === 2 && this.hands.length === 1) {
      bank += Math.floor(bet / 2);
      this.bets[this.active] = 0;
      this.phase = "done";
      this.note = `surrender. back ${Math.floor(bet / 2)}. n again`;
      this.render();
      return;
    }
    if (matchesKey(data, "i") && !this.insured && this.dealer[0]?.rank === "A" && bank >= Math.floor(bet / 2)) {
      this.insurance = takeBet(Math.floor(bet / 2));
      this.insured = true;
      this.note = value(this.dealer) === 21 ? "insurance. dealer blackjack" : "insurance. no blackjack";
      if (value(this.dealer) === 21) this.finish();
      else { this.note = `${this.note}. ${this.prompt()}`; this.render(); }
      return;
    }
    if (matchesKey(data, "e") && value(hand) === 21 && this.dealer[0]?.rank === "A" && this.hands.length === 1) {
      bank += bet * 2;
      this.bets[0] = 0;
      this.phase = "done";
      this.note = `even money +${bet}. n again`;
      this.render();
    }
  }

  lines(): string[] {
    const dealerCards = this.dealer.slice(0, this.shownDealer).map((card, i) => i > 0 && this.holeHidden ? `${MUTED}??${RESET}` : paint(card));
    const rows = this.hands.map((hand, i) => {
      const shown = i === this.active ? hand.slice(0, this.shownYou || hand.length) : hand;
      const mark = this.hands.length > 1 && i === this.active && this.phase === "play" ? `${LAVENDER}>${RESET}${BG} ` : "";
      return `${INK}${this.hands.length > 1 ? `h${i + 1}` : "you"}${RESET}${BG}  ${mark}${shown.map(paint).join("  ")}  ${shown.length ? value(shown) : ""}  ${MUTED}${this.bets[i] ?? 0}${RESET}`;
    });
    return [
      `${LAVENDER}blackjack${RESET}${BG}  ${MUTED}bank ${bank}${this.insurance ? `  ins ${this.insurance}` : ""}${RESET}`,
      `${INK}dealer${RESET}${BG}  ${dealerCards.join("  ") || `${MUTED}??${RESET}`}  ${this.holeHidden ? "" : value(this.dealer)}`,
      ...rows,
      `${MUTED}${this.note}${RESET}`,
    ];
  }
}

type Style = "tight" | "loose" | "wild";
type Bot = { name: string; style: Style; cards: Card[]; folded: boolean; street: number; stack: number; status: string };

function pickBots(): Bot[] {
  const names = ["Nico", "Jun", "Mara", "Sol", "Rhee", "Pax", "Ivo", "Noa", "Lux", "Kei"].sort(() => Math.random() - 0.5).slice(0, 3);
  const styles: Style[] = ["tight", "loose", "wild"].sort(() => Math.random() - 0.5) as Style[];
  return names.map((name, i) => ({ name, style: styles[i], cards: [], folded: false, street: 0, stack: 80 + Math.floor(Math.random() * 121), status: "" }));
}

export class Poker {
  private player: Card[] = [];
  private bots: Bot[] = [];
  private board: Card[] = [];
  private shownPlayer = 0;
  private shownBoard = 0;
  private bet = 10;
  private pot = 0;
  private streetBet = 0;
  private youStreet = 0;
  private youFolded = false;
  private lastRaise = 10;
  private pending: Array<"you" | number> = [];
  private yourTurn = false;
  private sizing = false;
  private typed = "";
  private street: "deal" | "you" | "flop" | "turn" | "river" | "show" | "done" = "deal";
  private note = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private render: () => void;

  constructor(render: () => void) {
    this.render = render;
    this.deal();
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private later(run: () => void): void {
    this.stop();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      run();
    }, 420);
    this.render();
  }

  private deal(): void {
    this.stop();
    if (bank === 0) bank = 100;
    this.bet = takeBet(10);
    this.pot = this.bet * 4;
    this.streetBet = 0;
    this.youStreet = 0;
    this.youFolded = false;
    this.sizing = false;
    this.typed = "";
    this.lastRaise = 10;
    this.shownPlayer = 0;
    this.shownBoard = 0;
    this.player = [];
    this.board = [];
    this.bots = pickBots();
    if (this.bet === 0) { this.street = "done"; this.pot = 0; this.note = "broke. q close"; this.render(); return; }
    const deck = shoe();
    this.player = [deck.pop()!, deck.pop()!];
    for (const bot of this.bots) bot.cards = [deck.pop()!, deck.pop()!];
    this.board = [deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!];
    this.street = "deal";
    this.note = "dealing your hand";
    this.later(() => this.reveal());
  }

  private reveal(): void {
    if (this.street === "deal") {
      this.shownPlayer += 1;
      if (this.shownPlayer < 2) { this.note = "dealing your hand"; this.later(() => this.reveal()); return; }
      this.street = "you";
      this.beginStreet("your hand");
      return;
    }
    if (this.street === "flop" && this.shownBoard < 3) {
      this.shownBoard += 1;
      this.note = "flop";
      this.later(() => this.reveal());
      return;
    }
    if (this.street === "flop") { this.beginStreet("flop"); return; }
    if (this.street === "turn" && this.shownBoard < 4) {
      this.shownBoard = 4;
      this.note = "turn";
      this.later(() => this.reveal());
      return;
    }
    if (this.street === "turn") { this.beginStreet("turn"); return; }
    if (this.street === "river" && this.shownBoard < 5) {
      this.shownBoard = 5;
      this.note = "river";
      this.later(() => this.reveal());
      return;
    }
    if (this.street === "river") this.beginStreet("river");
  }

  private liveBots(): number {
    return this.bots.filter(bot => !bot.folded).length;
  }

  private canAct(seat: "you" | number): boolean {
    return seat === "you" ? (!this.youFolded && bank > 0) : (!this.bots[seat].folded && this.bots[seat].stack > 0);
  }

  private activeActors(): Array<"you" | number> {
    return (["you", 0, 1, 2] as Array<"you" | number>).filter(seat => this.canAct(seat));
  }

  private beginStreet(label: string): void {
    this.streetBet = 0;
    this.youStreet = 0;
    this.lastRaise = 10;
    for (const bot of this.bots) {
      bot.street = 0;
      if (!bot.folded) bot.status = "";
    }
    const actors = this.activeActors();
    this.pending = actors.length > 1 ? actors : [];
    this.note = label;
    this.step();
  }

  private behind(actor: "you" | number): Array<"you" | number> {
    const order: Array<"you" | number> = ["you", 0, 1, 2];
    const at = order.indexOf(actor);
    return [...order.slice(at + 1), ...order.slice(0, at)].filter(seat => this.canAct(seat));
  }

  private step(): void {
    if (!this.youFolded && this.liveBots() === 0) { this.takePot("table folds"); return; }
    if (this.youFolded) { this.street = "done"; this.note = "you fold. n again"; this.render(); return; }
    const next = this.pending.shift();
    if (next === undefined) { this.nextStreet(); return; }
    if (next === "you") {
      if (!this.canAct("you")) { this.step(); return; }
      const call = this.streetBet - this.youStreet;
      this.yourTurn = true;
      this.sizing = false;
      this.typed = "";
      this.note = this.actionNote(call);
      this.render();
      return;
    }
    this.botAct(next);
  }

  private mood(cards: Card[]): "weak" | "ok" | "strong" {
    if (this.shownBoard === 0) {
      const vals = cards.map(card => rankValue(card.rank)).sort((a, b) => b - a);
      if (vals[0] === vals[1] || vals[0] >= 13) return "strong";
      if (vals[0] >= 10) return "ok";
      return "weak";
    }
    const score = bestHand([...cards, ...this.board.slice(0, this.shownBoard)]).score;
    if (score >= 2e10) return "strong";
    if (score >= 1e10) return "ok";
    return "weak";
  }

  private choose(bot: Bot, owe: number): "fold" | "check" | "call" | "raise" | "allin" {
    const mood = this.mood(bot.cards);
    const roll = Math.random();
    if (owe === 0) {
      if (bot.style === "wild" && roll < 0.72) return "raise";
      if (bot.style === "loose" && mood !== "weak" && roll < 0.4) return "raise";
      if (bot.style === "tight" && mood === "strong" && roll < 0.55) return "raise";
      return "check";
    }
    if (bot.style === "tight" && mood === "weak") return "fold";
    if (bot.style === "loose" && mood === "weak" && roll < 0.28) return "fold";
    if (mood === "strong" && bot.style === "wild" && roll < 0.22) return "allin";
    if (mood !== "weak" && (bot.style === "wild" ? roll < 0.6 : roll < 0.28)) return "raise";
    return "call";
  }

  private actionNote(call: number): string {
    const toCall = Math.min(call, bank);
    const callLabel = bank <= call ? `call ${toCall} (all-in)` : `call ${toCall}`;
    return call > 0
      ? `f fold  c ${callLabel}  r raise-to  a all-in  p pot  h half`
      : `f fold  c check  b bet  a all-in  p pot  h half`;
  }

  private botAct(index: number): void {
    const bot = this.bots[index];
    if (bot.folded || bot.stack === 0) { this.step(); return; }
    this.note = `${bot.name} is thinking`;
    this.render();
    this.later(() => {
      const owe = this.streetBet - bot.street;
      let action = this.choose(bot, owe);
      const canRaiseOthers = this.behind(index).length > 0;
      if (!canRaiseOthers && (action === "raise" || action === "allin")) {
        action = owe === 0 ? "check" : "call";
      }
      if (action === "fold") {
        bot.folded = true;
        bot.status = "folds";
      } else if (action === "check") {
        bot.status = "checks";
      } else if (action === "call" || bot.stack <= owe) {
        const paid = Math.min(owe, bot.stack);
        bot.stack -= paid;
        bot.street += paid;
        this.pot += paid;
        bot.status = bot.stack === 0 ? "all-in" : `calls ${paid}`;
      } else {
        const minPut = action === "allin" ? bot.stack : Math.min(bot.stack, owe + this.lastRaise);
        const put = action === "allin" ? bot.stack : minPut;
        const raiseBy = put - owe;
        if (raiseBy >= this.lastRaise) this.lastRaise = raiseBy;
        bot.stack -= put;
        bot.street += put;
        this.streetBet = bot.street;
        this.pot += put;
        bot.status = bot.stack === 0 ? "all-in" : owe === 0 ? `bets ${put}` : `raises to ${bot.street}`;
        this.pending = this.behind(index);
      }
      this.step();
    });
  }

  private takePot(why: string): void {
    bank += this.pot;
    this.street = "done";
    this.note = `${why}. you take ${this.pot}. n again`;
    this.render();
  }

  private nextStreet(): void {
    if (this.street === "you") { this.street = "flop"; this.note = "flop"; this.reveal(); }
    else if (this.street === "flop") { this.street = "turn"; this.reveal(); }
    else if (this.street === "turn") { this.street = "river"; this.reveal(); }
    else if (this.street === "river") this.showdown();
  }

  private showdown(): void {
    const contenders: { name: string; score: number; you: boolean; hand: string }[] = [];
    if (!this.youFolded) {
      const hand = bestHand([...this.player, ...this.board]);
      contenders.push({ name: "you", score: hand.score, you: true, hand: hand.name });
    }
    for (const bot of this.bots) {
      if (bot.folded) continue;
      const hand = bestHand([...bot.cards, ...this.board]);
      contenders.push({ name: bot.name, score: hand.score, you: false, hand: hand.name });
    }
    const best = Math.max(...contenders.map(seat => seat.score));
    const winners = contenders.filter(seat => seat.score === best);
    if (winners.some(seat => seat.you)) bank += Math.floor(this.pot / winners.length);
    this.street = "done";
    this.note = winners.length === 1
      ? `${winners[0].name} ${winners[0].hand}. n again`
      : `split ${winners.map(seat => seat.name).join(" ")}. n again`;
    this.render();
  }

  abandon(): void {
    this.stop();
    if (this.street !== "done") bank += this.bet;
  }

  input(data: string): void {
    if (matchesKey(data, "n") && this.street === "done") { this.deal(); return; }
    if (this.street === "done" || this.street === "deal" || this.timer || !this.yourTurn) return;
    if (this.sizing) { this.typeAmount(data); return; }
    if (matchesKey(data, "f")) {
      this.yourTurn = false;
      this.youFolded = true;
      this.pending = [];
      this.street = "done";
      this.note = "you fold. n again";
      this.render();
      return;
    }
    const call = this.streetBet - this.youStreet;
    const checkCall = matchesKey(data, "c") || matchesKey(data, "space") || matchesKey(data, "enter");
    if (checkCall && call === 0) { this.yourTurn = false; this.step(); return; }
    if (checkCall && call > 0) { this.pushChips(Math.min(call, bank), bank <= call); return; }
    if (matchesKey(data, "a")) { this.pushChips(bank, true); return; }
    if (matchesKey(data, "p")) { this.pushChips(this.sizedPut(1), false); return; }
    if (matchesKey(data, "h")) { this.pushChips(this.sizedPut(0.5), false); return; }
    if (matchesKey(data, "b") || matchesKey(data, "r")) {
      this.sizing = true;
      this.typed = "";
      this.note = `raise to ${this.minTo()}+ then enter   _`;
      this.render();
    }
  }

  private minTo(): number {
    const call = Math.max(0, this.streetBet - this.youStreet);
    return call === 0 ? this.youStreet + 10 : this.streetBet + this.lastRaise;
  }

  private sizedPut(part: number): number {
    const call = Math.max(0, this.streetBet - this.youStreet);
    const potAfterCall = this.pot + call;
    return call + Math.max(10, Math.floor(potAfterCall * part));
  }

  private pushChips(want: number, allIn: boolean): void {
    const call = Math.max(0, this.streetBet - this.youStreet);
    const paid = Math.min(allIn ? bank : want, bank);
    if (paid === 0) {
      this.yourTurn = false;
      this.note = "all-in";
      this.render();
      this.later(() => this.step());
      return;
    }
    if (!allIn && paid < call) { this.note = `need ${call} to call`; this.render(); return; }
    const to = this.youStreet + paid;
    const raiseBy = to - this.streetBet;
    if (!allIn && raiseBy > 0 && to < this.minTo()) { this.note = `min raise to ${this.minTo()}`; this.render(); return; }
    this.yourTurn = false;
    bank -= paid;
    this.bet += paid;
    this.youStreet += paid;
    this.pot += paid;
    if (raiseBy >= this.lastRaise) this.lastRaise = raiseBy;
    if (to > this.streetBet) {
      this.streetBet = to;
      this.pending = this.behind("you");
    }
    this.note = bank === 0 ? "you all-in" : call === 0 ? `you bet ${paid}` : raiseBy > 0 ? `you raise to ${to}` : "you call";
    this.render();
    this.later(() => this.step());
  }

  private typeAmount(data: string): void {
    if (matchesKey(data, "escape")) {
      this.sizing = false;
      this.note = this.actionNote(Math.max(0, this.streetBet - this.youStreet));
      this.render();
      return;
    }
    if (matchesKey(data, "backspace")) this.typed = this.typed.slice(0, -1);
    else if (/^[0-9]$/.test(data) && this.typed.length < 6) this.typed += data;
    else if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      const to = Number(this.typed);
      const min = this.minTo();
      if (!to || to < min) { this.note = `min raise to ${min}   ${this.typed || "_"}`; this.render(); return; }
      if (to - this.youStreet > bank) { this.note = `only have ${bank} chips   ${this.typed || "_"}`; this.render(); return; }
      this.sizing = false;
      this.pushChips(to - this.youStreet, false);
      return;
    }
    this.note = `raise to ${this.minTo()}+ then enter   ${this.typed || "_"}`;
    this.render();
  }

  lines(): string[] {
    const slot = (card?: Card) => card ? paint(card) : `${MUTED}??${RESET}`;
    const yours = this.player.slice(0, this.shownPlayer).map(paint).join("  ") || `${MUTED}??${RESET}`;
    const flop = [0, 1, 2].map(i => slot(i < this.shownBoard ? this.board[i] : undefined)).join("  ");
    const turn = slot(this.shownBoard >= 4 ? this.board[3] : undefined);
    const river = slot(this.shownBoard >= 5 ? this.board[4] : undefined);
    const seats = this.bots.map(bot => {
      const open = this.street === "done" && !bot.folded;
      const cards = open ? bot.cards.map(paint).join(" ") : `${MUTED}?? ??${RESET}`;
      const name = bot.name.padEnd(4, " ");
      return `${INK}${name}${RESET}${BG} ${cards}  ${MUTED}${bot.stack}  ${bot.status || bot.style}${RESET}`;
    });
    const call = bank > 0 ? Math.max(0, this.streetBet - this.youStreet) : 0;
    const yoursStatus = bank === 0 && !this.youFolded && this.street !== "done" ? `  ${MUTED}all-in${RESET}` : "";
    return [
      `${LAVENDER}hold'em${RESET}${BG}  ${MUTED}bank ${bank}  pot ${this.pot}${call ? `  call ${call}` : ""}${RESET}`,
      ...seats,
      `${INK}board${RESET}${BG}  ${flop}   ${turn}   ${river}`,
      `${INK}you${RESET}${BG}    ${yours}${yoursStatus}`,
      `${MUTED}${this.note}${RESET}`,
    ];
  }
}

class Room implements Component {
  private game: Blackjack | Poker;
  private name: GameName;
  private tui: TUI;
  private done: () => void;

  constructor(tui: TUI, done: () => void, start: GameName) {
    this.tui = tui;
    this.done = done;
    this.name = start;
    this.game = start === "poker" ? new Poker(() => tui.requestRender()) : new Blackjack(() => tui.requestRender());
  }

  private use(name: GameName): void {
    if (name === this.name) return;
    this.game.abandon();
    this.name = name;
    this.game = name === "poker" ? new Poker(() => this.tui.requestRender()) : new Blackjack(() => this.tui.requestRender());
    this.tui.requestRender();
  }

  handleInput(data: string): { consume: true } {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) { this.game.abandon(); this.done(); return { consume: true }; }
    if (matchesKey(data, "tab")) { this.use(this.name === "poker" ? "blackjack" : "poker"); return { consume: true }; }
    this.game.input(data);
    return { consume: true };
  }

  invalidate(): void {}

  render(width: number): string[] {
    return panel(width, this.game.lines());
  }
}

export function registerBlackjack(pi: ExtensionAPI): void {
  const open = async (ctx: ExtensionContext, start: GameName) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("The table needs the TUI", "error");
      return;
    }
    await ctx.ui.custom((tui: TUI, _theme, _kb, done) => new Room(tui, () => done(undefined), start), {
      overlay: true,
      overlayOptions: { anchor: "center", width: 62, maxHeight: 16 },
    });
  };
  pi.registerCommand("blackjack", {
    description: "Secret table. Blackjack, tab for poker",
    handler: async (_args, ctx) => open(ctx, "blackjack"),
  });
  pi.registerCommand("poker", {
    description: "Secret table. Hold'em streets, tab for blackjack",
    handler: async (_args, ctx) => open(ctx, "poker"),
  });
  pi.registerShortcut("ctrl+alt+b", {
    description: "Open the secret card table",
    handler: ctx => { void open(ctx, "blackjack"); },
  });
}
