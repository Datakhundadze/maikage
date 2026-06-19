import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAppState } from "@/hooks/useAppState";

// Public, continuous grayscale auto-scroll marquee of active partner logos.
// Reads the `partners` table (active rows, sort_order ASC) and resolves each
// logo via the public partner-logos bucket. Renders NOTHING when there are no
// active partners — no empty strip/heading until logos exist.

interface PartnerLogo {
  name: string;
  url: string;
}

export default function PartnerLogosMarquee() {
  const { lang } = useAppState();
  const [logos, setLogos] = useState<PartnerLogo[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // `partners` is schema-ahead-of-types — cast mirrors MyDesignsPage/admin.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("partners")
        .select("name, logo_path")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (cancelled || !data) return;
      const rows = (data as { name: string; logo_path: string }[]).map((r) => ({
        name: r.name,
        url: supabase.storage.from("partner-logos").getPublicUrl(r.logo_path).data.publicUrl,
      }));
      setLogos(rows);
    })();
    return () => { cancelled = true; };
  }, []);

  // Empty state: render nothing until there are active logos.
  if (logos.length === 0) return null;

  // Duplicate the track so translateX(-50%) loops seamlessly (one full set).
  const track = [...logos, ...logos];

  return (
    <div className="w-full max-w-5xl mb-20 sm:mb-28">
      <h2 className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-6">
        {lang === "en" ? "Trusted by" : "ისინი გვენდობიან"}
      </h2>
      {/* Edge fade + hover-pause. The track is width:max-content (2× the logos);
          animate-marquee shifts it left by 50% for a seamless loop. */}
      <div className="group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
        <div className="flex w-max items-center gap-10 sm:gap-14 animate-marquee group-hover:[animation-play-state:paused]">
          {track.map((logo, i) => (
            <img
              key={`${logo.name}-${i}`}
              src={logo.url}
              alt={logo.name}
              className="h-9 sm:h-11 w-auto max-w-[140px] object-contain grayscale opacity-60 transition-all duration-300 hover:grayscale-0 hover:opacity-100"
              loading="lazy"
              draggable={false}
              aria-hidden={i >= logos.length ? true : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
