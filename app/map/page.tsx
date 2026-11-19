import { redirect } from "next/navigation";

// Links to /map land on the front page, where the map is.
export default function MapPage() {
  redirect("/");
}
