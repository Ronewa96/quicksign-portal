import React from 'react';
import { MapPin } from 'lucide-react';
import { LocationRecord, formatLocation, mapUrl } from '../../lib/location';

/** A recorded location, linked to OpenStreetMap when one was shared. */
export const LocationText: React.FC<{ location?: LocationRecord; label?: string; className?: string }> = ({
  location,
  label,
  className = '',
}) => {
  const url = mapUrl(location);
  const text = formatLocation(location);
  return (
    <span className={`inline-flex items-start gap-1 min-w-0 ${className}`}>
      <MapPin className="w-3 h-3 shrink-0 mt-px" aria-hidden="true" />
      <span className="min-w-0 wrap-break-word">
        {label && <span>{label} </span>}
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-cyan-300">
            {text}
          </a>
        ) : (
          text
        )}
      </span>
    </span>
  );
};
