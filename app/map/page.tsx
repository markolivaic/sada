"use client";

import { useState } from "react";
import MapComponent from "@/components/MapComponent";
import SadaUI from "@/components/SadaUI";

export default function MapPage() {
  const [destination, setDestination] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  return (
    <div className="h-screen w-screen overflow-hidden relative">
      <MapComponent destination={destination} />
      <div className="absolute bottom-0 inset-x-0 z-10">
        <SadaUI onResult={(res) => setDestination(res.destination)} />
      </div>
    </div>
  );
}
