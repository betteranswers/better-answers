import { DotPattern, GridPattern, MarkedRegion } from "@/shared/blueprint.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/shared/ui/card.tsx";

/** Every blueprint part on one board, for the browser suite to measure as the served build draws it. */
export function BlueprintParts() {
  return (
    <GridPattern>
      <section aria-label="Board" className="grid gap-6 px-4 py-10">
        <MarkedRegion asChild className="p-4">
          <figure aria-label="Marked region">
            A figure
            <Card asChild marks className="mt-4 p-4">
              <section aria-label="Card in a marked region">Inherits, never repeats</section>
            </Card>
          </figure>
        </MarkedRegion>
        <Card asChild marks>
          <section aria-label="Marked card">
            <CardHeader>
              <CardTitle asChild>
                <h2>Coverage</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>18 of 24 concepts included</CardContent>
            <CardFooter>From the map</CardFooter>
          </section>
        </Card>
        <Card asChild>
          <section aria-label="Plain card">
            <CardContent>No marks</CardContent>
          </section>
        </Card>
        <DotPattern>
          <section aria-label="Empty" className="px-4 py-10">
            Nothing is here yet.
          </section>
        </DotPattern>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="accent">Approve this row</Button>
          <Button size="xs">Small primary</Button>
        </div>
      </section>
    </GridPattern>
  );
}
