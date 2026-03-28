"use client";

import MapComponent from "@/components/MapComponent";
import SadaUI from "@/components/SadaUI";

export default function MapPage() {
  return (
    <div className="h-screen w-screen overflow-hidden relative">
      <MapComponent />
      <div className="absolute bottom-0 inset-x-0 z-10">
        <SadaUI />
      </div>
    </div>
  );
}
