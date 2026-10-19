import { describe, it, expect, beforeEach } from "vitest";
import {
  averageRating,
  isRatingEligible,
  readRatingState,
  realReplyCount,
  writeRatingState,
} from "@/lib/chatRating";

type M = { role: "user" | "assistant"; local?: boolean };
const greet: M = { role: "assistant", local: true };
const user: M = { role: "user" };
const bot: M = { role: "assistant" };
const botErr: M = { role: "assistant", local: true };

describe("realReplyCount", () => {
  it("counts only server replies, not local greetings or error bubbles", () => {
    expect(realReplyCount([greet, user, bot, user, botErr, user, bot])).toBe(2);
    expect(realReplyCount([])).toBe(0);
  });
});

describe("isRatingEligible", () => {
  it("needs two real replies and the bot to have the last word", () => {
    expect(isRatingEligible([greet, user, bot], false)).toBe(false);
    expect(isRatingEligible([greet, user, bot, user, bot], false)).toBe(true);
    // customer just typed — mid-question
    expect(isRatingEligible([greet, user, bot, user, bot, user], false)).toBe(false);
  });
  it("is never eligible while a reply is in flight", () => {
    expect(isRatingEligible([greet, user, bot, user, bot], true)).toBe(false);
  });
  it("does not count error bubbles toward the threshold", () => {
    expect(isRatingEligible([greet, user, bot, user, botErr], false)).toBe(false);
  });
});

describe("rating state per session", () => {
  beforeEach(() => sessionStorage.clear());
  it("remembers rated / dismissed per session id only", () => {
    expect(readRatingState("a")).toBeNull();
    writeRatingState("a", "rated");
    writeRatingState("b", "dismissed");
    expect(readRatingState("a")).toBe("rated");
    expect(readRatingState("b")).toBe("dismissed");
    expect(readRatingState("c")).toBeNull();
  });
});

describe("averageRating", () => {
  it("rounds to one decimal and is null when empty", () => {
    expect(averageRating([])).toBeNull();
    expect(averageRating([5, 4, 4])).toBe(4.3);
    expect(averageRating([1])).toBe(1);
  });
});
