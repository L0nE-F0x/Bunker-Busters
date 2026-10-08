import type { GameContext } from '../context';
import type { Landmarks } from '../world/Landmarks';
import type { Site } from './Site';
import { JetSite } from './jet';
import { DriveInSite } from './drivein';
import { DataCenterSite } from './datacenter';
import { TubeSite } from './tube';
import { CourierSite } from './courier';

export type { Site } from './Site';
export { Errands } from './errands';

/** Every point of interest that isn't the Garage, the gas station, the Spire or Dry Creek. */
export function buildSites(ctx: GameContext, landmarks: Landmarks): Site[] {
  return [
    new JetSite(ctx, landmarks),
    new DriveInSite(ctx, landmarks),
    new DataCenterSite(ctx, landmarks),
    new TubeSite(ctx, landmarks),
    new CourierSite(ctx, landmarks),
  ];
}
