// Rapier interaction groups: upper 16 bits = membership, lower 16 = filter.

export const Layer = {
  WORLD: 1 << 0,
  CAT: 1 << 1,
  ECHO: 1 << 2,
  PROP: 1 << 3,
  CAMERA_BLOCK: 1 << 4,
} as const;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** Static level geometry: collides with everything. */
export const GROUP_WORLD = groups(Layer.WORLD | Layer.CAMERA_BLOCK, 0xffff);
/** Cats collide with the world, props and each other. */
export const GROUP_CAT = groups(Layer.CAT, Layer.WORLD | Layer.CAT | Layer.ECHO | Layer.PROP);
/** Past You: other cats bump into it, it never queries movement itself. */
export const GROUP_ECHO = groups(Layer.ECHO, Layer.CAT);
/** Queries that should only see static world (camera, ground probes). */
export const GROUP_QUERY_WORLD = groups(0xffff, Layer.WORLD);
/** Camera occlusion probes ignore thin decorative props. */
export const GROUP_QUERY_CAMERA = groups(0xffff, Layer.CAMERA_BLOCK);
