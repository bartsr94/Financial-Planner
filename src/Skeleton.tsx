// Grey shapes where content is still loading, laid out like the page they stand in for,
// so the page doesn't jump when the data arrives.

const Bar = ({ w = '100%', h = 12 }: { w?: number | string; h?: number }) => <div className="skel" style={{ width: w, height: h }} />;

/** A card with a title line and a block, as a chart or table card looks. */
export function SkeletonCard({ height = 180 }: { height?: number }) {
  return (
    <div className="card" aria-hidden>
      <Bar w={140} h={10} />
      <div style={{ height: 14 }} />
      <Bar h={height} />
    </div>
  );
}

/** Rows of a table or list. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skel-row"><Bar w={`${55 + ((i * 17) % 35)}%`} /><Bar w={70} /></div>)}
    </div>
  );
}

/** A page still loading: optional stat tiles over chart cards. */
export function SkeletonPage({ kpis = 0, cards = 2 }: { kpis?: number; cards?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {kpis > 0 && (
        <div className="kpis">
          {Array.from({ length: kpis }, (_, i) => (
            <div className="card kpi" key={i} aria-hidden><Bar w={70} h={10} /><div style={{ height: 12 }} /><Bar w="60%" h={26} /><div style={{ height: 10 }} /><Bar w="40%" h={10} /></div>))}
        </div>)}
      {Array.from({ length: cards }, (_, i) => <SkeletonCard key={i} height={i === 0 ? 220 : 160} />)}
    </div>
  );
}
