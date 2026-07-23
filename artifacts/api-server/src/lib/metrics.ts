export interface MetricDef {
  key: string;
  label: string;
  description: string;
  higherIsBetter: boolean;
}

export const METRICS: MetricDef[] = [
  {
    key: "positive_sentiment",
    label: "Positive Sentiment",
    description:
      "How positively US consumers feel about the brand overall",
    higherIsBetter: true,
  },
  {
    key: "negative_sentiment",
    label: "Negative Sentiment",
    description:
      "How much negative sentiment the brand carries among US consumers (higher score = more negative sentiment)",
    higherIsBetter: false,
  },
  {
    key: "ease_of_business",
    label: "Ease of Doing Business",
    description:
      "How easy and frictionless it is for US consumers to do business with the brand",
    higherIsBetter: true,
  },
  {
    key: "likelihood_to_recommend",
    label: "Likelihood to Recommend",
    description:
      "How likely US consumers are to recommend the brand to friends or family",
    higherIsBetter: true,
  },
  {
    key: "trustworthiness",
    label: "Trustworthiness",
    description:
      "How much US consumers trust the brand to act with honesty and integrity",
    higherIsBetter: true,
  },
  {
    key: "value_for_money",
    label: "Value for Money",
    description:
      "How strongly US consumers feel the brand delivers value relative to its price",
    higherIsBetter: true,
  },
  {
    key: "innovation",
    label: "Innovation & Momentum",
    description:
      "How innovative and forward-moving US consumers perceive the brand to be",
    higherIsBetter: true,
  },
];

export const METRIC_KEYS = METRICS.map((m) => m.key);

export function getMetric(key: string): MetricDef | undefined {
  return METRICS.find((m) => m.key === key);
}
