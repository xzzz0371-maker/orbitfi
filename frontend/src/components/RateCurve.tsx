"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { borrowAprAt, KINK1, KINK2 } from "@/lib/rates";

// The curve is drawn from lib/rates.ts so the chart can never drift away from the contract
// parameters. (It used to keep its own copy of the numbers, which is precisely how a chart
// ends up showing a curve the protocol no longer uses.)
export function RateCurve({ height = 260 }: { height?: number }) {
  const data = Array.from({ length: 21 }, (_, i) => {
    const util = i * 5;
    return {
      util,
      "Tier 1": Number(borrowAprAt(util, 1).toFixed(2)),
      "Tier 5": Number(borrowAprAt(util, 5).toFixed(2)),
    };
  });

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.08)" />
          <XAxis
            dataKey="util"
            tickFormatter={(v) => `${v}%`}
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={{ stroke: "rgba(15,23,42,0.12)" }}
            tickLine={false}
            label={{ value: "Utilization", position: "insideBottom", offset: -2, fill: "#64748b", fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v) => [`~${v}%`, undefined]}
            labelFormatter={(l) => `Utilization ${l}%`}
            contentStyle={{
              background: "rgba(255,255,255,0.92)",
              border: "1px solid rgba(15,23,42,0.1)",
              borderRadius: 12,
              boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine x={KINK1} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: `kink1 ${KINK1}%`, fill: "#f59e0b", fontSize: 10 }} />
          <ReferenceLine x={KINK2} stroke="#f97316" strokeDasharray="4 4" label={{ value: `kink2 ${KINK2}%`, fill: "#f97316", fontSize: 10 }} />
          <Line type="monotone" dataKey="Tier 1" stroke="#3b82f6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="Tier 5" stroke="#f97316" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
