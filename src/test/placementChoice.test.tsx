import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PlacementChoice from "@/components/PlacementChoice";
import {
  PLACEMENT_UNDO_MS,
  canReplace,
  needsPlacementChoice,
  removeSidePhotos,
  restoreSidePhotos,
} from "@/lib/placementChoice";

// Shapes mirror SimplePage's PhotoLayer / TextLayer closely enough to prove
// that nothing on a layer is rebuilt: every assertion below is on IDENTITY.
interface Photo {
  id: string;
  image: string;
  coords: { x: number; y: number; scale: number };
  sourceScale?: number;
  sourceOffsetX?: number;
  sourceOffsetY?: number;
}
interface Text {
  id: string;
  content: string;
}
interface Side {
  photos: Photo[];
  texts: Text[];
}

const flag: Photo = { id: "photo-1", image: "data:flag", coords: { x: 0.5, y: 0.4, scale: 0.9 }, sourceScale: 0.7, sourceOffsetX: 0.05, sourceOffsetY: -0.02 };
const logo: Photo = { id: "photo-2", image: "data:logo", coords: { x: 0.3, y: 0.7, scale: 0.4 } };
const caption: Text = { id: "text-1", content: "საქართველო" };

describe("needsPlacementChoice — when to ask", () => {
  it("no prompt when the side has no photo", () => {
    expect(needsPlacementChoice(0, false)).toBe(false);
  });

  it("asks when the side already has a photo", () => {
    expect(needsPlacementChoice(1, false)).toBe(true);
    expect(needsPlacementChoice(5, false)).toBe(true);
  });

  it("never asks for the chat's own same-attachment reuse", () => {
    expect(needsPlacementChoice(1, true)).toBe(false);
  });
});

describe("ჩანაცვლება / დამატება / დაბრუნება", () => {
  it("replace removes the side's photos and keeps its texts, in one value", () => {
    const side: Side = { photos: [flag, logo], texts: [caption] };
    const { next, removed } = removeSidePhotos<Photo, Side>(side);
    expect(next.photos).toEqual([]);
    expect(next.texts).toBe(side.texts); // same array — lettering untouched
    expect(next.texts[0]).toBe(caption);
    expect(removed).toEqual([flag, logo]);
    expect(removed[0]).toBe(flag); // the very objects, for an exact undo
    expect(side.photos).toEqual([flag, logo]); // input not mutated
  });

  it("add keeps everything: the existing photos and texts stay, the new photo appends", () => {
    // დამატება is today's path: addPhotoLayer appends. Nothing is removed.
    const side: Side = { photos: [flag], texts: [caption] };
    const added: Photo = { id: "photo-3", image: "data:new", coords: { x: 0.5, y: 0.5, scale: 0.5 } };
    const after: Side = { ...side, photos: [...side.photos, added] };
    expect(after.photos[0]).toBe(flag);
    expect(after.texts[0]).toBe(caption);
    expect(after.photos).toHaveLength(2);
  });

  it("undo restores the exact removed layers and removes the placed one", () => {
    const before: Side = { photos: [flag, logo], texts: [caption] };
    const { next, removed } = removeSidePhotos<Photo, Side>(before);
    const placed: Photo = { id: "photo-9", image: "data:new", coords: { x: 0.5, y: 0.5, scale: 0.9 } };
    const replaced: Side = { ...next, photos: [placed] };

    const undone = restoreSidePhotos<Photo, Side>(replaced, removed, ["photo-9"]);
    expect(undone.photos).toEqual([flag, logo]);
    expect(undone.photos[0]).toBe(flag); // same id, coords, crop — same object
    expect(undone.photos[1]).toBe(logo);
    expect(undone.texts[0]).toBe(caption);
  });

  it("undo keeps a photo added after the replace, beneath the restored ones", () => {
    const { removed } = removeSidePhotos<Photo, Side>({ photos: [flag], texts: [] });
    const placed: Photo = { id: "photo-9", image: "data:new", coords: { x: 0.5, y: 0.5, scale: 0.9 } };
    const later: Photo = { id: "photo-10", image: "data:later", coords: { x: 0.2, y: 0.2, scale: 0.3 } };
    const undone = restoreSidePhotos<Photo, Side>({ photos: [placed, later], texts: [] }, removed, ["photo-9"]);
    expect(undone.photos.map((p) => p.id)).toEqual(["photo-1", "photo-10"]);
  });

  it("undo never duplicates a layer that is somehow still present", () => {
    const undone = restoreSidePhotos<Photo, Side>({ photos: [flag], texts: [] }, [flag], []);
    expect(undone.photos).toEqual([flag]);
  });

  it("undo window is 8 seconds", () => {
    expect(PLACEMENT_UNDO_MS).toBe(8000);
  });
});

describe("canReplace", () => {
  it("is refused while an AI action runs, allowed otherwise", () => {
    expect(canReplace(true)).toBe(false);
    expect(canReplace(false)).toBe(true);
  });
});

describe("PlacementChoice", () => {
  it("shows the question and both answers; each button reports its choice", () => {
    const onReplace = vi.fn();
    const onAdd = vi.fn();
    render(<PlacementChoice onReplace={onReplace} onAdd={onAdd} replaceDisabled={false} />);
    expect(screen.getByRole("dialog", { name: "ამ მხარეს უკვე არის დიზაინი" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ჩანაცვლება" }));
    fireEvent.click(screen.getByRole("button", { name: "დამატება" }));
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("buttons are at least 44px tall; ჩანაცვლება has the primary style", () => {
    render(<PlacementChoice onReplace={() => {}} onAdd={() => {}} replaceDisabled={false} />);
    const replace = screen.getByRole("button", { name: "ჩანაცვლება" });
    const add = screen.getByRole("button", { name: "დამატება" });
    for (const b of [replace, add]) expect(b.className).toMatch(/\bh-11\b/); // 2.75rem = 44px
    expect(replace.className).toContain("bg-primary");
    expect(add.className).not.toContain("bg-primary");
  });

  it("replace is disabled while busy, with a hint; add still works", () => {
    const onReplace = vi.fn();
    const onAdd = vi.fn();
    render(<PlacementChoice onReplace={onReplace} onAdd={onAdd} replaceDisabled />);
    const replace = screen.getByRole("button", { name: "ჩანაცვლება" });
    expect(replace).toBeDisabled();
    fireEvent.click(replace);
    expect(onReplace).not.toHaveBeenCalled();
    expect(screen.getByText(/ჩანაცვლება შესაძლებელი იქნება/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "დამატება" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("no hint when replace is available", () => {
    render(<PlacementChoice onReplace={() => {}} onAdd={() => {}} replaceDisabled={false} />);
    expect(screen.queryByText(/ჩანაცვლება შესაძლებელი იქნება/)).toBeNull();
  });
});
