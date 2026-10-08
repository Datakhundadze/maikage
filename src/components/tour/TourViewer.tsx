import { useEffect, useRef, useState } from "react";
import { Viewer } from "@photo-sphere-viewer/core";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import {
  VirtualTourPlugin,
  type VirtualTourNode,
  type VirtualTourPluginConfig,
} from "@photo-sphere-viewer/virtual-tour-plugin";
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import "@photo-sphere-viewer/virtual-tour-plugin/index.css";
import "./tourViewer.css";
import type { TourNode } from "@/lib/tour/tourConfig";

// 360° tour viewer for /showroom. Photo Sphere Viewer and its CSS are imported
// HERE ONLY (and this file only from the lazy ShowroomPage), so three.js and
// the viewer stay in the /showroom chunk and never reach the main bundle.
//
// STACKING: the wrapper is `isolate`, so every z-index the viewer uses
// internally (up to 9999) is contained inside it and the whole tour sits below
// the sitewide chat launcher (z-50). The navbar is also kept clear of the
// launcher's corner (tourViewer.css).

const DEG = Math.PI / 180;

// Viewer UI strings in Georgian (same keys as the library's English defaults).
const LANG_KA: Record<string, string> = {
  zoom: "მასშტაბი",
  zoomOut: "დაშორება",
  zoomIn: "მიახლოება",
  moveUp: "ზემოთ",
  moveDown: "ქვემოთ",
  moveLeft: "მარცხნივ",
  moveRight: "მარჯვნივ",
  description: "აღწერა",
  download: "ჩამოტვირთვა",
  fullscreen: "სრულ ეკრანზე",
  loading: "იტვირთება…",
  menu: "მენიუ",
  close: "დახურვა",
  twoFingers: "გადასაადგილებლად გამოიყენეთ ორი თითი",
  ctrlZoom: "მასშტაბისთვის გამოიყენეთ Ctrl + სქროლი",
  loadError: "პანორამა ვერ ჩაიტვირთა",
  webglError: "თქვენი ბრაუზერი 360° ხედს ვერ აჩვენებს",
};

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function toViewerNode(node: TourNode): VirtualTourNode {
  return {
    id: node.id,
    panorama: node.panoramaUrl,
    name: node.name_ka,
    caption: node.name_ka,
    panoData: node.panoData,
    links: node.links.map((l) => ({
      nodeId: l.nodeId,
      position: { yaw: l.yaw * DEG, pitch: l.pitch * DEG },
    })),
  };
}

interface TourViewerProps {
  nodes: TourNode[];
  startNodeId: string;
}

export default function TourViewer({ nodes, startNodeId }: TourViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [webgl] = useState(hasWebGL);

  useEffect(() => {
    const container = containerRef.current;
    if (!webgl || !container) return;

    const tourConfig: VirtualTourPluginConfig = {
      positionMode: "manual",
      renderMode: "2d",
      nodes: nodes.map(toViewerNode),
      startNodeId,
      preload: true,
    };

    const viewer = new Viewer({
      container,
      lang: LANG_KA,
      loadingTxt: LANG_KA.loading,
      navbar: ["zoom", "caption", "fullscreen"],
      plugins: [MarkersPlugin, [VirtualTourPlugin, tourConfig]],
    });

    return () => viewer.destroy();
  }, [webgl, nodes, startNodeId]);

  if (!webgl) {
    const start = nodes.find((n) => n.id === startNodeId) ?? nodes[0];
    return (
      <div className="tour-viewer relative isolate flex h-full w-full flex-col bg-black">
        {start && (
          <img
            src={start.panoramaUrl}
            alt={start.name_ka}
            className="min-h-0 w-full flex-1 object-cover"
          />
        )}
        {/* pr-24 keeps the text clear of the chat launcher's corner */}
        <p className="bg-black/80 py-3 pl-4 pr-24 text-sm text-white">
          თქვენი ბრაუზერი 360° ხედს ვერ აჩვენებს — ნაჩვენებია ჩვეულებრივი ფოტო.
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className="tour-viewer relative isolate h-full w-full bg-black" />;
}
