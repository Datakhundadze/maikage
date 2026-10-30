import { Ruler } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getSizeChart } from "@/lib/sizeCharts";

interface SizeChartLinkProps {
  subProduct: string | undefined | null;
  lang?: "ge" | "en" | string;
  className?: string;
}

/**
 * "Size chart" link + dialog for the selected brand. Renders nothing when no
 * chart is on file for that brand (see src/lib/sizeCharts.ts).
 */
export function SizeChartLink({ subProduct, lang = "ge", className = "" }: SizeChartLinkProps) {
  const rows = getSizeChart(subProduct);
  if (!rows) return null;
  const en = lang === "en";
  const hasNote = rows.some((r) => r.note);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-2 ${className}`}
        >
          <Ruler className="h-3.5 w-3.5" aria-hidden />
          {en ? "Size chart" : "ზომების ცხრილი"}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{en ? `Size chart — ${subProduct}` : `ზომების ცხრილი — ${subProduct}`}</DialogTitle>
          <DialogDescription>
            {en
              ? "Centimetres. Length: shoulder to hem. Width: chest, measured flat."
              : "სანტიმეტრებში. სიგრძე — მხრიდან ქვედა კიდემდე. სიგანე — გულმკერდზე, ბრტყლად გაზომილი."}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 pr-3 text-left font-medium">{en ? "Size" : "ზომა"}</th>
                {hasNote && <th className="py-2 pr-3 text-left font-medium">{en ? "Age" : "ასაკი"}</th>}
                <th className="py-2 pr-3 text-right font-medium">{en ? "Length" : "სიგრძე"}</th>
                <th className="py-2 text-right font-medium">{en ? "Width" : "სიგანე"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.size} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3 font-semibold">{r.size}</td>
                  {hasNote && <td className="py-2 pr-3 text-muted-foreground">{r.note ?? ""}</td>}
                  <td className="py-2 pr-3 text-right">{r.length}</td>
                  <td className="py-2 text-right">{r.width}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          {en
            ? "Tip: lay your favourite T-shirt flat and compare. Unsure? Ask us in the chat."
            : "რჩევა: გაშალეთ თქვენი საყვარელი მაისური და შეადარეთ. ეჭვი თუ გაქვთ, მოგვწერეთ ჩატში."}
        </p>
      </DialogContent>
    </Dialog>
  );
}
