import { MapPin } from "lucide-react";

export function MapAddressLink({ name, address }: { name: string; address: string }) {
  if (!address.trim()) return null;
  const query = [name.trim(), address.trim()].filter(Boolean).join(" ");
  const href = `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query })}`;
  return <a className="map-address-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${address}（Google マップで開く）`}><MapPin size={15} aria-hidden="true" /><span>{address}</span></a>;
}
