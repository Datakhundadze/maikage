import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import SeoHead from "@/components/SeoHead";

// Privacy policy — a real route (/privacy) with a #data-deletion section, so
// one URL serves both the "Privacy Policy URL" and the "Data deletion
// instructions URL" fields in the Meta App dashboard.
//
// ⚠️ EVERY CLAIM BELOW WAS WRITTEN FROM THE CODE, NOT FROM A TEMPLATE. If a
// table, bucket, tracker or third party changes, this text is wrong until it
// is changed too. The branch summary that introduced it lists, per claim, the
// file it was verified against. Retention statements are deliberately honest:
// where nothing deletes a record, the text says so.
//
// ⚠️ OWNER REVIEW REQUIRED before this goes live. Search for "TODO_OWNER" —
// each one is a value only the business can fill in (response time, legal
// entity details, retention decisions). The page renders a visible "draft"
// notice while any placeholder remains.

const CONTACT_EMAIL = "maika@maika.ge";
const LAST_UPDATED = "2026-09-23";

// ── Placeholders the owner must fill in ──────────────────────────────────
// Kept in one place so the draft banner can detect them. Replace the values
// and the banner disappears.
const TODO_OWNER = {
  /** How long a deletion request takes to complete, e.g. "30 days" / "30 დღე". */
  deletionResponseTime: { ge: "2–3 სამუშაო დღე", en: "2–3 working days" },
  /** Legal entity as it should appear: name, id, registered address. */
  legalEntity: { ge: "შპს MAIKA.GE (ს/კ 404430175), ქ. თბილისი, იერუსალიმის ქ. 2/5", en: "MAIKA.GE LLC (ID 404430175), 2/5 Ierusalimi St, Tbilisi" },
  /** How long paid-order records are kept after a deletion request (accounting). */
  orderRecordRetention: { ge: "3 წელი", en: "3 years" },
};
const HAS_PLACEHOLDERS = JSON.stringify(TODO_OWNER).includes("TODO_OWNER");

type L = "ge" | "en";
const t = (lang: L, ge: string, en: string) => (lang === "en" ? en : ge);

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li className="pl-1">{children}</li>;
}

export default function PrivacyPage() {
  const { lang, setMode } = useAppState();
  const location = useLocation();
  const L: L = lang === "en" ? "en" : "ge";

  // The route is lazy-loaded: on a direct visit to /privacy#data-deletion the
  // browser's own hash scroll fires before the section exists. Re-scroll once
  // the page has rendered.
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView({ block: "start" });
  }, [location.hash]);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-white">
      <SeoHead
        title={t(L, "კონფიდენციალურობის პოლიტიკა — Maika.ge", "Privacy Policy — Maika.ge")}
        description={t(
          L,
          "რა მონაცემებს აგროვებს Maika.ge შეკვეთისას, ჩატში, დიზაინის შექმნისას და Facebook/Instagram მიმოწერისას, სად ინახება და როგორ მოითხოვოთ წაშლა.",
          "What Maika.ge collects when you order, chat, create a design or message us on Facebook and Instagram, where it is stored, and how to ask for deletion.",
        )}
        url="https://maika.ge/privacy"
      />

      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link
          to="/"
          onClick={() => setMode("landing")}
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-white/40 hover:text-gray-900 dark:hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t(L, "მთავარი გვერდი", "Home")}
        </Link>

        {HAS_PLACEHOLDERS && (
          <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            {t(
              L,
              "სამუშაო ვერსია: ეს გვერდი მფლობელის გადახედვას ელოდება. ტექსტში „TODO_OWNER“ ადგილები შესავსებია.",
              "Draft: this page is awaiting the owner's review. Items marked “TODO_OWNER” still need to be filled in.",
            )}
          </div>
        )}

        {/* text-2xl on phones: "კონფიდენციალურობის" at text-3xl is wider than a
            360px viewport and forced a horizontal scroll. */}
        <h1 className="text-2xl sm:text-3xl font-bold mb-2 break-words">{t(L, "კონფიდენციალურობის პოლიტიკა", "Privacy Policy")}</h1>
        <p className="text-sm text-gray-500 dark:text-white/40 mb-8">
          {t(L, "ბოლო განახლება", "Last updated")}: {LAST_UPDATED} ·{" "}
          <a href="#data-deletion" className="underline hover:text-gray-900 dark:hover:text-white">
            {t(L, "მონაცემების წაშლა", "Data deletion")}
          </a>
        </p>

        <div className="prose prose-gray dark:prose-invert max-w-none text-gray-600 dark:text-white/60 leading-relaxed">
          <p>
            {t(
              L,
              "ეს გვერდი მარტივად აღწერს, რა ინფორმაციას ვაგროვებთ maika.ge-ზე, რატომ, სად ინახება და როგორ შეგიძლიათ მისი წაშლა მოითხოვოთ. ის დაწერილია იმის მიხედვით, რასაც ჩვენი საიტი რეალურად აკეთებს, და არა ზოგადი შაბლონით.",
              "This page describes, in plain words, what information we collect on maika.ge, why, where it is stored, and how you can ask us to delete it. It is written from what our site actually does, not from a template.",
            )}
          </p>
          <p>
            {t(L, "მონაცემებზე პასუხისმგებელი", "Responsible for your data")}: {TODO_OWNER.legalEntity[L]}.{" "}
            {t(L, "კონტაქტი", "Contact")}: <a href={`mailto:${CONTACT_EMAIL}`} className="underline">{CONTACT_EMAIL}</a>.
          </p>

          <Section id="orders" title={t(L, "1. შეკვეთები", "1. Orders")}>
            <p>
              {t(
                L,
                "შეკვეთის გაფორმებისას ვითხოვთ სახელს, გვარს, ელფოსტას, ტელეფონის ნომერს, მიწოდების მისამართს (თუ ირჩევთ მიწოდებას) და, სურვილისამებრ, კომენტარს. ეს გვჭირდება შეკვეთის დასამზადებლად, დასაკავშირებლად და მისაწოდებლად.",
                "When you place an order we ask for your first and last name, email, phone number, a delivery address (if you choose delivery) and an optional comment. We need these to make, confirm and deliver your order.",
              )}
            </p>
            <p>
              {t(
                L,
                "შეკვეთასთან ერთად ვინახავთ თქვენს დიზაინს: პროდუქტზე დადებულ სურათს (მოკაპს) და თქვენ მიერ ატვირთული ფოტოების სრული ზომის ორიგინალებს, რომლებიც ბეჭდვისთვისაა საჭირო. ვირტუალური მოსინჯვის („გასახდელის“) გამოყენებისას, თუ ამის შემდეგ შეკვეთას აფორმებთ, თქვენი ფოტო და მოსინჯვის შედეგიც შეკვეთას ერთვის.",
                "With the order we keep your design: the picture placed on the product (the mockup) and the full-size originals of any photos you uploaded, which are needed for printing. If you use the virtual try-on and then order, your try-on photo and its result are attached to the order too.",
              )}
            </p>
            <p>
              {t(
                L,
                "ახალი შეკვეთის შესახებ შეტყობინება ჩვენს მისამართზე (maika@maika.ge) იგზავნება Resend-ის საშუალებით; ეს წერილი შეიცავს თქვენს სახელს, გვარს და შეკვეთის დეტალებს.",
                "A notification about each new order is emailed to our own address (maika@maika.ge) through Resend; that email contains your name and the order details.",
              )}
            </p>
            <p>
              <strong>{t(L, "შენახვის ვადა", "Retention")}:</strong>{" "}
              {t(
                L,
                "შეკვეთის ჩანაწერები და მათზე მიბმული ფაილები ავტომატურად არ იშლება. წაშლა შეგიძლიათ მოითხოვოთ ქვემოთ აღწერილი წესით.",
                "Order records and the files attached to them are not deleted automatically. You can request deletion as described below.",
              )}
            </p>
          </Section>

          <Section id="payments" title={t(L, "2. გადახდა", "2. Payments")}>
            <p>
              {t(
                L,
                "გადახდას ამუშავებს საქართველოს ბანკი (BOG), თიბისი ბანკი (TBC) ან Flitt — იმის მიხედვით, რომელს აირჩევთ. ბარათის ნომერი და სხვა საბანკო მონაცემები შეგყავთ ბანკის/გადამხდელის გვერდზე და ჩვენს სერვერებზე არასოდეს ხვდება. ჩვენ გადამხდელს ვუგზავნით მხოლოდ შეკვეთის ნომერს, თანხას, ვალუტას და აღწერას, უკან კი ვიღებთ გადახდის სტატუსს.",
                "Payments are processed by Bank of Georgia (BOG), TBC Bank or Flitt, depending on what you choose. Your card number and other banking details are entered on the bank's or provider's page and never reach our servers. We send the provider only the order number, the amount, the currency and a description, and receive back the payment status.",
              )}
            </p>
          </Section>

          <Section id="chat" title={t(L, "3. საიტის ჩატი", "3. Site chat")}>
            <p>
              {t(
                L,
                "საიტზე ჩატის ასისტენტი ხელოვნურ ინტელექტს იყენებს. თქვენი შეტყობინებები და ასისტენტის პასუხები ინახება ჩვენს ბაზაში, რათა შევძლოთ საუბრების გადახედვა და ასისტენტის გაუმჯობესება. შენახვამდე ტელეფონის ნომრები და ელფოსტის მისამართები იფარება (ბოლო ორი ციფრი და ელფოსტის დომენი რჩება), ასე რომ თქვენი სრული ნომერი ჩანაწერში არ ინახება.",
                "The chat assistant on the site uses AI. Your messages and the assistant's replies are stored in our database so we can review conversations and improve the assistant. Before storing, phone numbers and email addresses are masked (the last two digits and the email domain are kept), so your full number is not in the record.",
              )}
            </p>
            <p>
              {t(
                L,
                "ჩატში გაგზავნილი ფოტოები ინახება დახურულ საცავში, რომელსაც მხოლოდ ჩვენი ადმინისტრატორები ხედავენ. მასკირება ტექსტს ეხება; ფოტოზე ჩანს ის, რაც გადაიღეთ.",
                "Photos sent in the chat are stored in a private storage area that only our administrators can access. The masking applies to text; a photo shows whatever you photographed.",
              )}
            </p>
            <p>
              <strong>{t(L, "შენახვის ვადა", "Retention")}:</strong>{" "}
              {t(
                L,
                "ჩატის ჩანაწერები და ფოტოები ავტომატურად არ იშლება.",
                "Chat records and photos are not deleted automatically.",
              )}
            </p>
          </Section>

          <Section id="designs" title={t(L, "4. ატვირთული ფოტოები და დიზაინები", "4. Uploaded photos and designs")}>
            <p>
              {t(
                L,
                "კონსტრუქტორში ატვირთული ფოტოები თქვენს ბრაუზერშია, სანამ არ დაასრულებთ შეკვეთას ან კალათაში არ ჩადებთ. კალათაში ჩადებისას სურათი ჩვენს საცავში იტვირთება. AI-ით შექმნილი დიზაინები (მოკაპი და გამჭვირვალე ვერსია) ინახება ჩვენს საცავში და ჩანაწერში, რომელიც სტუმრებისთვის ბრაუზერის ანონიმურ იდენტიფიკატორზეა მიბმული, ხოლო შესული მომხმარებლებისთვის — ანგარიშზე.",
                "Photos you upload in the constructor stay in your browser until you order or add to the cart. Adding to the cart uploads the picture to our storage. AI-generated designs (the mockup and the transparent version) are stored in our storage and in a record that is tied to an anonymous browser identifier for guests, or to your account if you are signed in.",
              )}
            </p>
            <p>
              {t(
                L,
                "შესული მომხმარებლების დიზაინები „ჩემი დიზაინების“ გვერდზე ინახება; თუ დიზაინს „გამოაქვეყნებთ“, ის კატალოგში ყველასთვის ჩანს.",
                "Signed-in users' designs are kept on the “My Designs” page; if you publish a design, it is visible to everyone in the catalog.",
              )}
            </p>
            <p>
              {t(
                L,
                "ვირტუალური მოსინჯვისას თქვენი ფოტო ბრაუზერში რჩება (ჩანართის დახურვამდე) და ჩვენს საცავში მხოლოდ მაშინ იტვირთება, თუ შედეგით შეკვეთას აფორმებთ.",
                "During virtual try-on your photo stays in your browser (until the tab is closed) and is uploaded to our storage only if you order with the result.",
              )}
            </p>
            <p>
              <strong>{t(L, "სად", "Where")}:</strong>{" "}
              {t(
                L,
                "დიზაინები, კალათის სურათები, შეკვეთის ორიგინალები და მოსინჯვის ფოტოები ერთ საცავშია, რომელიც ბმულით ხელმისაწვდომია მისი ზუსტი მისამართის მცოდნესთვის. ბმულები საიტზე არ ქვეყნდება, მაგრამ ეს დახურული საცავი არ არის.",
                "Designs, cart pictures, order originals and try-on photos are in one storage area whose files are reachable by anyone who knows a file's exact address. The addresses are not published on the site, but this is not a private store.",
              )}
            </p>
            <p>
              <strong>{t(L, "შენახვის ვადა", "Retention")}:</strong>{" "}
              {t(L, "ავტომატურად არ იშლება.", "Not deleted automatically.")}
            </p>
          </Section>

          <Section id="ai" title={t(L, "5. ხელოვნური ინტელექტი", "5. AI processing")}>
            <p>
              {t(
                L,
                "დიზაინის გენერაცია, ფონის მოხსნა, რედაქტირება, გადიდება, ვირტუალური მოსინჯვა და ჩატის ასისტენტი Google-ის Gemini მოდელებს იყენებს, რომლებსაც Lovable-ის AI შლუზის (gateway) მეშვეობით ვუკავშირდებით. თქვენი ატვირთული სურათები, მოსინჯვის ფოტო და თქვენ მიერ დაწერილი აღწერები ამ მოდელებს დამუშავებისთვის ეგზავნება. ჩატის ტექსტი მოდელს მასკირების გარეშე ეგზავნება; მასკირება მხოლოდ ჩვენს ბაზაში შენახვისას ხდება.",
                "Design generation, background removal, editing, upscaling, virtual try-on and the chat assistant use Google's Gemini models, which we reach through the Lovable AI gateway. Your uploaded pictures, your try-on photo and the descriptions you type are sent to those models for processing. Chat text is sent to the model unmasked; masking happens only when we store it in our database.",
              )}
            </p>
            <p>
              {t(
                L,
                "ყოველი AI გამოძახების შესახებ ვინახავთ ტექნიკურ ჩანაწერს (მოქმედება, მოდელი, ხანგრძლივობა, წარმატება/შეცდომა და, შესული მომხმარებლისთვის, ანგარიშის იდენტიფიკატორი) ხარჯების და შეცდომების სამართავად. ეს ჩანაწერი არ შეიცავს სურათს ან ტექსტს.",
                "For every AI call we keep a technical record (the action, the model, duration, success or error, and the account identifier for signed-in users) to manage cost and errors. That record contains no image and no text.",
              )}
            </p>
          </Section>

          <Section id="social" title={t(L, "6. Facebook და Instagram მიმოწერა", "6. Facebook Messenger and Instagram messages")}>
            <p>
              {t(
                L,
                "თუ გვწერთ Facebook Messenger-ში ან Instagram-ის პირად შეტყობინებებში, Meta-ს Messenger Platform API-ის მეშვეობით ვიღებთ თქვენს შეტყობინებებს და ჩვენს პასუხებს და ვინახავთ ჩვენს ბაზაში, რათა შევძლოთ საუბრების გადახედვა და მომსახურების გაუმჯობესება. ვინახავთ: შეტყობინების ტექსტს (ტელეფონის ნომრები და ელფოსტები მასკირებულია, ისევე როგორც საიტის ჩატში), დანართების ტიპსა და Meta-ს დროებით ბმულს, შეტყობინების დროს, არხს (Messenger ან Instagram) და Meta-ს მიერ მინიჭებულ ანონიმურ იდენტიფიკატორებს (Page-Scoped ID / Instagram-Scoped ID).",
                "If you message us on Facebook Messenger or in Instagram direct messages, we receive your messages and our replies through Meta's Messenger Platform API and store them in our database so we can review conversations and improve our service. We store: the message text (phone numbers and emails masked, exactly as in the site chat), the type of any attachment and Meta's temporary link to it, the time the message was sent, the channel (Messenger or Instagram), and the anonymous identifiers Meta assigns (Page-Scoped ID / Instagram-Scoped ID).",
              )}
            </p>
            <p>
              {t(
                L,
                "არ ვინახავთ თქვენს სახელს, პროფილის ფოტოს ან პროფილის სხვა ინფორმაციას Meta-სგან და არ ვაგზავნით ავტომატურ პასუხებს ამ სისტემიდან. დანართების ბმულები Meta-ს მხრიდან დროებითია და ვადა გასდის; ფოტოებს ჩვენს საცავში არ ვინახავთ.",
                "We do not store your name, profile picture or any other profile information from Meta, and this system sends no automatic replies. Attachment links from Meta are temporary and expire; we do not save the photos themselves.",
              )}
            </p>
            <p>
              <strong>{t(L, "შენახვის ვადა", "Retention")}:</strong>{" "}
              {t(
                L,
                "ეს ჩანაწერები ავტომატურად არ იშლება. თქვენი შეტყობინების Facebook-ში ან Instagram-ში წაშლა ჩვენს ასლს არ შლის — წაშლა ქვემოთ აღწერილი წესით მოითხოვეთ.",
                "These records are not deleted automatically. Deleting your message on Facebook or Instagram does not delete our copy; request deletion as described below.",
              )}
            </p>
          </Section>

          <Section id="accounts" title={t(L, "7. ანგარიშები", "7. Accounts")}>
            <p>
              {t(
                L,
                "ანგარიშებს Supabase Auth მართავს. შესვლა შესაძლებელია ელფოსტით და პაროლით, Google-ით ან Apple-ით (Lovable-ის ავტორიზაციის სერვისის მეშვეობით), ან სტუმრად. Google-ით ან Apple-ით შესვლისას ვიღებთ თქვენს ელფოსტას, სახელს და პროფილის სურათის ბმულს და ვინახავთ პროფილში. სტუმრის ანგარიშს ელფოსტა არ აქვს. უმოქმედობის 20 წუთის შემდეგ ავტომატურად გამოხვალთ.",
                "Accounts are managed by Supabase Auth. You can sign in with email and password, with Google or Apple (through Lovable's sign-in service), or as a guest. When you sign in with Google or Apple we receive your email, name and profile picture link and keep them in your profile. A guest account has no email. You are signed out automatically after 20 minutes of inactivity.",
              )}
            </p>
          </Section>

          <Section id="analytics" title={t(L, "8. ანალიტიკა და ბრაუზერის მეხსიერება", "8. Analytics and browser storage")}>
            <p>
              {t(
                L,
                "საიტი იყენებს Google Analytics 4-ს და Google Tag Manager-ს, რომლებიც Google-ის ქუქიებს აყენებს და ვიზიტების სტატისტიკას Google-ს უგზავნის. გარდა ამისა, ჩვენს ბაზაში ვინახავთ საკუთარ მოვლენებს: შესული მომხმარებლების გვერდის ვიზიტებს, დიზაინის გენერაციას და პროდუქტის არჩევას, ასევე კონსტრუქტორის ტექნიკურ მოვლენებს ანონიმური სესიის იდენტიფიკატორით.",
                "The site uses Google Analytics 4 and Google Tag Manager, which set Google cookies and send visit statistics to Google. We also store our own events in our database: signed-in users' page visits, design generations and product selections, and technical constructor events under an anonymous session identifier.",
              )}
            </p>
            <p>
              {t(
                L,
                "თქვენს ბრაუზერში ვინახავთ: ენას, თემას, კალათას, არჩეულ პროდუქტს, სტუმრის ანონიმურ იდენტიფიკატორს, გენერაციების მრიცხველს, ჩატის ტრანსკრიპტს (ჩანართის დახურვამდე) და, Google/Apple-ით შესვლის დროს, თქვენს დაუსრულებელ დიზაინს, რომ შესვლის შემდეგ არ დაიკარგოს. ეს ინფორმაცია თქვენს მოწყობილობაშია და ჩვენ არ გვეგზავნება.",
                "In your browser we store: language, theme, your cart, the selected product, an anonymous guest identifier, generation counters, the chat transcript (until the tab closes) and, while you sign in with Google or Apple, your unfinished design so it is not lost. This stays on your device and is not sent to us.",
              )}
            </p>
            <p>
              {t(
                L,
                "ბოროტად გამოყენების თავიდან ასაცილებლად AI ფუნქციებზე ლიმიტი მოქმედებს: შესული მომხმარებლებისთვის ანგარიშის მიხედვით, სტუმრებისთვის — IP მისამართის მიხედვით. ამისთვის IP მისამართი ჩვენს ბაზაში იწერება. ეს ჩანაწერები ავტომატურად მხოლოდ მაშინ იშლება, როცა იმავე IP-დან ახალი მოთხოვნა შემოდის; ერთჯერადი ვიზიტორის ჩანაწერი შეიძლება განუსაზღვრელი ვადით დარჩეს.",
                "To prevent abuse, AI features are rate-limited: per account for signed-in users, per IP address for guests. For that, the IP address is written to our database. Those records are cleaned up automatically only when a new request arrives from the same IP; a one-time visitor's record may remain indefinitely.",
              )}
            </p>
          </Section>

          <Section id="other" title={t(L, "9. სხვა ფორმები", "9. Other forms")}>
            <p>
              {t(
                L,
                "კორპორატიული მოთხოვნის ფორმა ინახავს კომპანიის სახელს, საიდენტიფიკაციო კოდს, საკონტაქტო პირს, ტელეფონს, ელფოსტას, კომენტარს და ლოგოს (დახურულ საცავში) და იმავე ინფორმაციას ელფოსტით გვიგზავნის. უკუკავშირის ფორმა ინახავს თქვენს შეტყობინებას და, თუ მიუთითებთ, ელფოსტას. არცერთი ავტომატურად არ იშლება.",
                "The corporate inquiry form stores the company name, tax ID, contact person, phone, email, comment and logo (in a private storage area) and emails the same information to us. The feedback form stores your message and, if you give it, your email. Neither is deleted automatically.",
              )}
            </p>
          </Section>

          <Section id="rights" title={t(L, "10. თქვენი უფლებები", "10. Your rights")}>
            <p>
              {t(
                L,
                "შეგიძლიათ მოითხოვოთ, რომ გითხრათ, რა მონაცემი გვაქვს თქვენზე, გავასწოროთ ან წავშალოთ. მოგვწერეთ",
                "You can ask us what data we hold about you, ask us to correct it, or ask us to delete it. Write to",
              )}{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline">{CONTACT_EMAIL}</a>.{" "}
              {t(L, "პასუხს გაგცემთ", "We will respond within")} {TODO_OWNER.deletionResponseTime[L]}
              {t(L, "-ის განმავლობაში.", ".")}
            </p>
          </Section>

          <Section id="data-deletion" title={t(L, "11. მონაცემების წაშლა", "11. Data deletion")}>
            <p>
              {t(
                L,
                "თქვენი მონაცემების წასაშლელად გააკეთეთ შემდეგი:",
                "To have your data deleted, do the following:",
              )}
            </p>
            <ol className="list-decimal pl-6 space-y-2">
              <Li>
                {t(L, "გამოგზავნეთ წერილი მისამართზე", "Send an email to")}{" "}
                <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t(L, "მონაცემების წაშლის მოთხოვნა", "Data deletion request"))}`} className="underline">{CONTACT_EMAIL}</a>{" "}
                {t(L, "თემით „მონაცემების წაშლის მოთხოვნა“.", "with the subject “Data deletion request”.")}
              </Li>
              <Li>
                {t(
                  L,
                  "მიუთითეთ, რა უნდა წაიშალოს და როგორ გამოგიცნოთ: ანგარიშის ელფოსტა, შეკვეთის ნომერი, ან — Facebook/Instagram მიმოწერისთვის — თქვენი პროფილის სახელი და მიახლოებითი თარიღი, როდესაც მოგვწერეთ. Meta-ს იდენტიფიკატორები, რომლებსაც ვინახავთ, თქვენს სახელს არ შეიცავს, ამიტომ ეს დეტალები გვჭირდება საუბრის მოსაძებნად.",
                  "Tell us what should be deleted and how to identify you: your account email, an order number, or, for Facebook or Instagram messages, your profile name and roughly when you wrote to us. The Meta identifiers we store do not contain your name, so we need these details to find the conversation.",
                )}
              </Li>
              <Li>
                {t(
                  L,
                  "თუ შესაძლებელია, მოთხოვნა იმავე ელფოსტიდან გამოგზავნეთ, რომლითაც შეკვეთა გააფორმეთ ან ანგარიში შექმენით — ასე დავრწმუნდებით, რომ მოთხოვნა თქვენგანაა.",
                  "If possible, send the request from the email address you used for the order or account, so we can be sure the request is yours.",
                )}
              </Li>
              <Li>
                {t(L, "დადასტურებას მიიღებთ", "You will receive confirmation within")} {TODO_OWNER.deletionResponseTime[L]}
                {t(L, "-ის განმავლობაში.", ".")}
              </Li>
            </ol>
            <p>
              {t(
                L,
                "რას ვშლით: თქვენს ანგარიშს და პროფილს, დიზაინებს და ატვირთულ ფოტოებს, ჩატის ჩანაწერებს და ფოტოებს, Facebook/Instagram მიმოწერის ჩვენს ასლს, უკუკავშირს და კორპორატიულ მოთხოვნებს. გადახდილი შეკვეთების ჩანაწერები (სახელი, კონტაქტი, თანხა) აღრიცხვისთვის ინახება",
                "What we delete: your account and profile, your designs and uploaded photos, chat records and photos, our copy of your Facebook and Instagram messages, feedback and corporate inquiries. Records of paid orders (name, contact details, amount) are kept for accounting for",
              )}{" "}
              {TODO_OWNER.orderRecordRetention[L]}
              {t(L, "-ის განმავლობაში.", ".")}
            </p>
            <p>
              {t(
                L,
                "ეს არ ეხება Google-ის, Meta-ს ან ბანკების მიერ საკუთარ სისტემებში შენახულ მონაცემებს — მათთვის იმ სერვისების პოლიტიკა მოქმედებს.",
                "This does not cover data that Google, Meta or the banks hold in their own systems; their own policies apply there.",
              )}
            </p>
          </Section>

          <Section id="changes" title={t(L, "12. ცვლილებები", "12. Changes")}>
            <p>
              {t(
                L,
                "თუ საიტი ახალ მონაცემებს დაიწყებს შეგროვებას ან ახალ სერვისს დაამატებს, ეს გვერდი განახლდება და თარიღი შეიცვლება.",
                "If the site starts collecting new data or adds a new service, this page will be updated and the date above will change.",
              )}
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
