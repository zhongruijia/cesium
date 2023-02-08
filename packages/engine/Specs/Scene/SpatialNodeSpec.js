import {
  Cartesian3,
  Matrix4,
  SpatialNode,
  VoxelBoxShape,
} from "../../index.js";

describe("Scene/SpatialNode", function () {
  it("constructs", function () {
    const shape = new VoxelBoxShape();
    const modelMatrix = Matrix4.IDENTITY.clone();
    const minBounds = VoxelBoxShape.DefaultMinBounds.clone();
    const maxBounds = VoxelBoxShape.DefaultMaxBounds.clone();
    shape.update(modelMatrix, minBounds, maxBounds);

    const level = 0;
    const x = 1;
    const y = 2;
    const z = 3;
    const parent = undefined;
    const dimensions = new Cartesian3(2, 3, 4);

    const node = new SpatialNode(level, x, y, z, parent, shape, dimensions);

    expect(node.level).toEqual(0);
    expect(node.screenSpaceError).toEqual(0.0);
  });

  it("computes child node coordinates", function () {
    const shape = new VoxelBoxShape();
    const modelMatrix = Matrix4.IDENTITY.clone();
    const minBounds = VoxelBoxShape.DefaultMinBounds.clone();
    const maxBounds = VoxelBoxShape.DefaultMaxBounds.clone();
    shape.update(modelMatrix, minBounds, maxBounds);

    const level = 1;
    const x = 1;
    const y = 1;
    const z = 1;
    const parent = undefined;
    const dimensions = new Cartesian3(32, 32, 32);

    const node = new SpatialNode(level, x, y, z, parent, shape, dimensions);

    const childCoordinates = node.getChildCoordinates();

    expect(childCoordinates).toEqual([
      [2, 2, 2, 2],
      [2, 3, 2, 2],
      [2, 2, 3, 2],
      [2, 3, 3, 2],
      [2, 2, 2, 3],
      [2, 3, 2, 3],
      [2, 2, 3, 3],
      [2, 3, 3, 3],
    ]);
  });
});
