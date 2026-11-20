// Customer feedback 2026-11-20: centring a text / photo layer in the constructor.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import DraggablePlacement, { CENTER_SNAP } from "@/components/DraggablePlacement";

describe("DraggablePlacement centring", () => {
  it("the buttons centre the layer horizontally / vertically", () => {
    const onChange = vi.fn();
    render(
      <div style={{ position: "relative", width: 400, height: 400 }}>
        <DraggablePlacement coords={{ x: 0.3, y: 0.7, scale: 0.4 }} onCoordsChange={onChange} />
      </div>,
    );
    fireEvent.click(screen.getByLabelText(/Center horizontally/));
    expect(onChange).toHaveBeenLastCalledWith({ x: 0.5, y: 0.7, scale: 0.4 });
    fireEvent.click(screen.getByLabelText(/Center vertically/));
    expect(onChange).toHaveBeenLastCalledWith({ x: 0.3, y: 0.5, scale: 0.4 });
  });
  it("snap distance is small", () => {
    expect(CENTER_SNAP).toBeGreaterThan(0);
    expect(CENTER_SNAP).toBeLessThanOrEqual(0.03);
  });
});
