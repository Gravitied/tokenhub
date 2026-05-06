export type TelemetryInput = {
  capability: string;
  estimatedToolCostTokens: number;
  estimatedSavedTokens: number;
  outputTokens: number;
  metadata?: Record<string, unknown>;
};

export type TelemetryRecord = TelemetryInput & {
  id: string;
  createdAt: string;
  roi: number;
  graduated: boolean;
};

export type TelemetryOptions = {
  roiThreshold?: number;
};

export class TokenTelemetry {
  private readonly records: TelemetryRecord[] = [];
  private readonly roiThreshold: number;

  constructor(options: TelemetryOptions = {}) {
    this.roiThreshold = options.roiThreshold ?? 3;
  }

  record(input: TelemetryInput): TelemetryRecord {
    const roi =
      input.estimatedToolCostTokens === 0
        ? Number.POSITIVE_INFINITY
        : input.estimatedSavedTokens / input.estimatedToolCostTokens;
    const record: TelemetryRecord = {
      ...input,
      id: `tel_${this.records.length + 1}`,
      createdAt: new Date().toISOString(),
      roi,
      graduated: roi >= this.roiThreshold
    };
    this.records.push(record);
    return record;
  }

  all(): TelemetryRecord[] {
    return [...this.records];
  }

  summary(): {
    totalRecords: number;
    roiThreshold: number;
    graduatedCapabilities: string[];
    averageRoi: number;
  } {
    const graduatedCapabilities = Array.from(
      new Set(this.records.filter((record) => record.graduated).map((record) => record.capability))
    ).sort();
    const averageRoi =
      this.records.length === 0
        ? 0
        : this.records.reduce((sum, record) => sum + record.roi, 0) / this.records.length;

    return {
      totalRecords: this.records.length,
      roiThreshold: this.roiThreshold,
      graduatedCapabilities,
      averageRoi
    };
  }
}
