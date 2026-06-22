import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin, Phone, Smartphone, Mail, Clock } from "lucide-react";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import { supabase } from "@/integrations/supabase/client";

// Showroom coordinates (also used by the Google Maps embed + LocalBusiness geo).
const LAT = 41.7231446;
const LNG = 44.7910174;

// Opens our pin in the Google Maps app/site (mirrors the ContactBar place link).
const MAPS_PLACE_URL =
  "https://www.google.com/maps/place/Maika.ge/@41.7231446,44.7910174,17z/data=!3m1!4b1!4m6!3m5!1s0x404473c7faeeac33:0x51850ad0fd75a99b!8m2!3d41.7231446!4d44.7910174!16s%2Fg%2F11h6g3tpzr";
// Keyless interactive embed centered on the pin.
const MAPS_EMBED_URL = `https://www.google.com/maps?q=${LAT},${LNG}&z=17&hl=ka&output=embed`;

// Phones: friendly display text + a dialable E.164 tel: href (mobile carries
// the full +995 country code even though it's shown locally).
const PHONES = [
  { display: "+(995 32) 2 05 06 20", tel: "+995322050620", mobile: false },
  { display: "+599 05 08 07", tel: "+995599050807", mobile: true },
];

// LocalBusiness schema — mirrors the FAQPage / Organization JSON-LD pattern
// (emitted via SeoHead's `schemas` prop). Sunday is omitted from the opening
// hours spec, which schema.org reads as "closed".
const LOCAL_BUSINESS_SCHEMA = {
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "ClothingStore"],
  name: "maika.ge",
  image: `${SITE_URL}/maika-logo.png`,
  url: `${SITE_URL}/contact`,
  telephone: "+995322050620",
  email: "maika@maika.ge",
  address: {
    "@type": "PostalAddress",
    streetAddress: "დინამოს სტადიონი, კარი #10",
    addressLocality: "Tbilisi",
    addressCountry: "GE",
  },
  geo: {
    "@type": "GeoCoordinates",
    latitude: LAT,
    longitude: LNG,
  },
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "11:00",
      closes: "19:00",
    },
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: "Saturday",
      opens: "11:00",
      closes: "18:00",
    },
  ],
};

interface ShowroomPhoto {
  name: string | null;
  url: string;
}

export default function ContactPage() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<ShowroomPhoto[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // `showroom_photos` is schema-ahead-of-types — cast mirrors AdminShowroom.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("showroom_photos")
        .select("name, photo_path")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (cancelled || !data) return;
      const rows = (data as { name: string | null; photo_path: string }[]).map((r) => ({
        name: r.name,
        url: supabase.storage.from("showroom-photos").getPublicUrl(r.photo_path).data.publicUrl,
      }));
      setPhotos(rows);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-white">
      <SeoHead
        title="კონტაქტი და შოურუმი | Maika.ge"
        description="მოგვაკითხეთ შოურუმში — დინამოს სტადიონი, კარი #10. სამუშაო საათები, ტელეფონი, ელფოსტა და მდებარეობა რუკაზე."
        url={`${SITE_URL}/contact`}
        schemas={[LOCAL_BUSINESS_SCHEMA]}
      />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-white/40 hover:text-gray-900 dark:hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          მთავარი გვერდი
        </button>

        <h1 className="text-3xl font-bold mb-2">კონტაქტი და შოურუმი</h1>
        <p className="text-gray-500 dark:text-white/50 leading-relaxed mb-10">
          მოგვაკითხეთ ადგილზე ან დაგვიკავშირდით — სიამოვნებით დაგეხმარებით.
        </p>

        {/* Contact details */}
        <div className="grid gap-4 sm:grid-cols-2 mb-10">
          {/* Address */}
          <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 flex gap-3">
            <MapPin className="h-5 w-5 shrink-0 text-[#26BB89]" />
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#26BB89] mb-1">მისამართი</h2>
              <a
                href={MAPS_PLACE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium hover:underline"
              >
                დინამოს სტადიონი, კარი #10
              </a>
            </div>
          </div>

          {/* Working hours */}
          <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 flex gap-3">
            <Clock className="h-5 w-5 shrink-0 text-[#26BB89]" />
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#26BB89] mb-1">სამუშაო საათები</h2>
              <ul className="text-sm space-y-0.5">
                <li>ორშ–პარ <span className="font-medium">11:00–19:00</span></li>
                <li>შაბ <span className="font-medium">11:00–18:00</span></li>
                <li className="text-gray-500 dark:text-white/50">კვირა დაკეტილი</li>
              </ul>
            </div>
          </div>

          {/* Phones */}
          <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 flex gap-3">
            <Phone className="h-5 w-5 shrink-0 text-[#26BB89]" />
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#26BB89] mb-1">ტელეფონი</h2>
              <ul className="text-sm space-y-0.5">
                {PHONES.map((p) => (
                  <li key={p.tel}>
                    <a href={`tel:${p.tel}`} className="font-medium hover:underline inline-flex items-center gap-1.5">
                      {p.mobile && <Smartphone className="h-3.5 w-3.5 text-gray-400" />}
                      {p.display}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Email */}
          <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 flex gap-3">
            <Mail className="h-5 w-5 shrink-0 text-[#26BB89]" />
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#26BB89] mb-1">ელფოსტა</h2>
              <a href="mailto:maika@maika.ge" className="text-sm font-medium hover:underline">
                maika@maika.ge
              </a>
            </div>
          </div>
        </div>

        {/* Map */}
        <section className="mb-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#26BB89] mb-3">მდებარეობა</h2>
          <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 aspect-video">
            <iframe
              title="Maika.ge შოურუმი — Google Maps"
              src={MAPS_EMBED_URL}
              className="h-full w-full"
              style={{ border: 0 }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
          <a
            href={MAPS_PLACE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-white/50 hover:text-[#26BB89] transition-colors"
          >
            <MapPin className="h-3.5 w-3.5" /> გახსენი Google Maps-ში
          </a>
        </section>

        {/* Showroom gallery — renders nothing until active photos exist. */}
        {photos.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#26BB89] mb-3">შოურუმი</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((p, i) => (
                <div
                  key={`${p.url}-${i}`}
                  className="aspect-square rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-white/5"
                >
                  <img
                    src={p.url}
                    alt={p.name || "შოურუმი"}
                    className="h-full w-full object-cover transition duration-300 hover:scale-105"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
