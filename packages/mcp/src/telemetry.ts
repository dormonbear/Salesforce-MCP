/*
 * Copyright 2026, Salesforce, Inc.
 * Modifications Copyright 2026, Dormon Zhou
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { TelemetryService } from '@dormon/mcp-provider-api';

type Attributes = Record<string, unknown>;

/**
 * No-op telemetry implementation.
 * The fork does not collect any telemetry data.
 */
export class Telemetry implements TelemetryService {
  public addAttributes(_attributes: Attributes): void {
    // no-op
  }

  public sendEvent(_eventName: string, _attributes?: Attributes): void {
    // no-op
  }

  public async start(): Promise<void> {
    // no-op
  }

  public stop(): void {
    // no-op
  }
}
