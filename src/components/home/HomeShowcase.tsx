import HomeCatalogShowcase from "./HomeCatalogShowcase";
import HomeWorkStrip from "./HomeWorkStrip";

// The lazy chunk behind HomeShowcaseSlot: "მზა დიზაინები" rail, then the
// "ჩვენი ნამუშევრები" photo strip. Each renders nothing on its own when its
// data is missing.
export default function HomeShowcase() {
  return (
    <>
      <HomeCatalogShowcase />
      <HomeWorkStrip />
    </>
  );
}
