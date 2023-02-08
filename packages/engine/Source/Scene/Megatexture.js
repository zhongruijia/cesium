import Cartesian2 from "../Core/Cartesian2.js";
import Cartesian3 from "../Core/Cartesian3.js";
import ComponentDatatype from "../Core/ComponentDatatype.js";
import ContextLimits from "../Renderer/ContextLimits.js";
import defaultValue from "../Core/defaultValue.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import DeveloperError from "../Core/DeveloperError.js";
import CesiumMath from "../Core/Math.js";
import MetadataComponentType from "./MetadataComponentType.js";
import PixelDatatype from "../Renderer/PixelDatatype.js";
import PixelFormat from "../Core/PixelFormat.js";
import RuntimeError from "../Core/RuntimeError.js";
import Sampler from "../Renderer/Sampler.js";
import Texture from "../Renderer/Texture.js";
import TextureMagnificationFilter from "../Renderer/TextureMagnificationFilter.js";
import TextureMinificationFilter from "../Renderer/TextureMinificationFilter.js";
import TextureWrap from "../Renderer/TextureWrap.js";

/**
 * @alias Megatexture
 * @constructor
 *
 * @param {Context} context
 * @param {Cartesian3} dimensions
 * @param {Number} channelCount
 * @param {MetadataComponentType} componentType
 * @param {Number} [textureMemoryByteLength]
 *
 * @private
 */
function Megatexture(
  context,
  dimensions,
  channelCount,
  componentType,
  textureMemoryByteLength
) {
  // TODO there are a lot of texture packing rules, see https://github.com/CesiumGS/cesium/issues/9572
  // Unsigned short textures not allowed in webgl 1, so treat as float
  if (componentType === MetadataComponentType.UNSIGNED_SHORT) {
    componentType = MetadataComponentType.FLOAT32;
  }

  if (
    componentType === MetadataComponentType.FLOAT32 &&
    !context.floatingPointTexture
  ) {
    throw new RuntimeError("Floating point texture not supported");
  }

  const pixelType = getPixelDataType(componentType);
  const pixelFormat = getPixelFormat(channelCount, context.webgl2);

  const maximumTextureMemoryByteLength = 512 * 1024 * 1024;
  const defaultTextureMemoryByteLength = 128 * 1024 * 1024;
  textureMemoryByteLength = Math.min(
    defaultValue(textureMemoryByteLength, defaultTextureMemoryByteLength),
    maximumTextureMemoryByteLength
  );
  const pixelSizeInBytes =
    MetadataComponentType.getSizeInBytes(componentType) * channelCount;
  const texelCount = Math.floor(textureMemoryByteLength / pixelSizeInBytes);
  const textureDimension = Math.min(
    ContextLimits.maximumTextureSize,
    CesiumMath.previousPowerOfTwo(Math.floor(Math.sqrt(texelCount)))
  );

  const sliceCountPerRegionX = Math.ceil(Math.sqrt(dimensions.x));
  const sliceCountPerRegionY = Math.ceil(dimensions.z / sliceCountPerRegionX);
  const voxelCountPerRegionX = sliceCountPerRegionX * dimensions.x;
  const voxelCountPerRegionY = sliceCountPerRegionY * dimensions.y;
  const regionCountPerMegatextureX = Math.floor(
    textureDimension / voxelCountPerRegionX
  );
  const regionCountPerMegatextureY = Math.floor(
    textureDimension / voxelCountPerRegionY
  );

  if (regionCountPerMegatextureX === 0 || regionCountPerMegatextureY === 0) {
    throw new RuntimeError("Tileset is too large to fit into megatexture");
  }

  /**
   * @type {Number}
   * @readonly
   */
  this.channelCount = channelCount;

  /**
   * @type {MetadataComponentType}
   * @readonly
   */
  this.componentType = componentType;

  /**
   * @type {Cartesian3}
   * @readonly
   */
  this.voxelCountPerTile = Cartesian3.clone(dimensions, new Cartesian3());

  /**
   * @type {Number}
   * @readonly
   */
  this.maximumTileCount =
    regionCountPerMegatextureX * regionCountPerMegatextureY;

  /**
   * @type {Cartesian2}
   * @readonly
   */
  this.regionCountPerMegatexture = new Cartesian2(
    regionCountPerMegatextureX,
    regionCountPerMegatextureY
  );

  /**
   * @type {Cartesian2}
   * @readonly
   */
  this.voxelCountPerRegion = new Cartesian2(
    voxelCountPerRegionX,
    voxelCountPerRegionY
  );

  /**
   * @type {Cartesian2}
   * @readonly
   */
  this.sliceCountPerRegion = new Cartesian2(
    sliceCountPerRegionX,
    sliceCountPerRegionY
  );

  /**
   * @type {Cartesian2}
   * @readonly
   */
  this.voxelSizeUv = new Cartesian2(
    1.0 / textureDimension,
    1.0 / textureDimension
  );

  /**
   * @type {Cartesian2}
   * @readonly
   */
  this.sliceSizeUv = new Cartesian2(
    dimensions.x / textureDimension,
    dimensions.y / textureDimension
  );

  /**
   * @type {Cartesian2}
   * @readonly
   */
  this.regionSizeUv = new Cartesian2(
    voxelCountPerRegionX / textureDimension,
    voxelCountPerRegionY / textureDimension
  );

  /**
   * @type {Texture}
   * @readonly
   */
  this.texture = new Texture({
    context: context,
    pixelFormat: pixelFormat,
    pixelDatatype: pixelType,
    flipY: false,
    width: textureDimension,
    height: textureDimension,
    sampler: new Sampler({
      wrapS: TextureWrap.CLAMP_TO_EDGE,
      wrapT: TextureWrap.CLAMP_TO_EDGE,
      minificationFilter: TextureMinificationFilter.LINEAR,
      magnificationFilter: TextureMagnificationFilter.LINEAR,
    }),
  });

  const componentDatatype = MetadataComponentType.toComponentDatatype(
    componentType
  );

  /**
   * @type {Array}
   */
  this.tileVoxelDataTemp = ComponentDatatype.createTypedArray(
    componentDatatype,
    voxelCountPerRegionX * voxelCountPerRegionY * channelCount
  );

  /**
   * @type {MegatextureNode[]}
   * @readonly
   */
  this.nodes = new Array(this.maximumTileCount);
  for (let tileIndex = 0; tileIndex < this.maximumTileCount; tileIndex++) {
    this.nodes[tileIndex] = new MegatextureNode(tileIndex);
  }
  for (let tileIndex = 0; tileIndex < this.maximumTileCount; tileIndex++) {
    const node = this.nodes[tileIndex];
    node.previousNode = tileIndex > 0 ? this.nodes[tileIndex - 1] : undefined;
    node.nextNode =
      tileIndex < this.maximumTileCount - 1
        ? this.nodes[tileIndex + 1]
        : undefined;
  }

  /**
   * @type {MegatextureNode}
   * @readonly
   */
  this.occupiedList = undefined;

  /**
   * @type {MegatextureNode}
   * @readonly
   */
  this.emptyList = this.nodes[0];

  /**
   * @type {Number}
   * @readonly
   */
  this.occupiedCount = 0;
}

/**
 * @private
 * @param {Number} channelCount The number of channels
 * @param {Boolean} webgl2 true if the rendering context is WebGL2
 * @returns {PixelFormat}
 */
function getPixelFormat(channelCount, webgl2) {
  switch (channelCount) {
    case 1:
      return webgl2 ? PixelFormat.RED : PixelFormat.LUMINANCE;
    case 2:
      return webgl2 ? PixelFormat.RG : PixelFormat.LUMINANCE_ALPHA;
    case 3:
      return PixelFormat.RGB;
    case 4:
      return PixelFormat.RGBA;
  }
}

/**
 * @private
 * @param {MetadataComponentType} componentType
 * @returns {PixelDataType}
 */
function getPixelDataType(componentType) {
  // TODO support more
  switch (componentType) {
    case MetadataComponentType.FLOAT32:
    case MetadataComponentType.FLOAT64:
      return PixelDatatype.FLOAT;
    case MetadataComponentType.UINT8:
      return PixelDatatype.UNSIGNED_BYTE;
  }
}

/**
 * @alias MegatextureNode
 * @constructor
 *
 * @param {Number} index
 *
 * @private
 */
function MegatextureNode(index) {
  /**
   * @type {Number}
   */
  this.index = index;

  /**
   * @type {MegatextureNode}
   */
  this.nextNode = undefined;

  /**
   * @type {MegatextureNode}
   */
  this.previousNode = undefined;
}

/**
 * @param {Array} data
 * @returns {Number}
 */
Megatexture.prototype.add = function (data) {
  if (this.isFull()) {
    throw new DeveloperError("Trying to add when there are no empty spots");
  }

  // remove head of empty list
  const node = this.emptyList;
  this.emptyList = this.emptyList.nextNode;
  if (defined(this.emptyList)) {
    this.emptyList.previousNode = undefined;
  }

  // make head of occupied list
  node.nextNode = this.occupiedList;
  if (defined(node.nextNode)) {
    node.nextNode.previousNode = node;
  }
  this.occupiedList = node;

  const index = node.index;
  this.writeDataToTexture(index, data);

  this.occupiedCount++;
  return index;
};

/**
 * @param {Number} index
 */
Megatexture.prototype.remove = function (index) {
  if (index < 0 || index >= this.maximumTileCount) {
    throw new DeveloperError("Megatexture index out of bounds");
  }

  // remove from list
  const node = this.nodes[index];
  if (defined(node.previousNode)) {
    node.previousNode.nextNode = node.nextNode;
  }
  if (defined(node.nextNode)) {
    node.nextNode.previousNode = node.previousNode;
  }

  // make head of empty list
  node.nextNode = this.emptyList;
  if (defined(node.nextNode)) {
    node.nextNode.previousNode = node;
  }
  node.previousNode = undefined;
  this.emptyList = node;
  this.occupiedCount--;
};

/**
 * @returns {Boolean}
 */
Megatexture.prototype.isFull = function () {
  return this.emptyList === undefined;
};

/**
 * @param {Number} tileCount
 * @param {Cartesian3} dimensions
 * @param {Number} channelCount number of channels in the metadata. Must be 1 to 4.
 * @param {MetadataComponentType} componentType
 * @returns {Number}
 */
Megatexture.getApproximateTextureMemoryByteLength = function (
  tileCount,
  dimensions,
  channelCount,
  componentType
) {
  // TODO there's a lot of code duplicate with Megatexture constructor

  // Unsigned short textures not allowed in webgl 1, so treat as float
  if (componentType === MetadataComponentType.UNSIGNED_SHORT) {
    componentType = MetadataComponentType.FLOAT32;
  }

  const voxelCountTotal =
    tileCount * dimensions.x * dimensions.y * dimensions.z;

  const sliceCountPerRegionX = Math.ceil(Math.sqrt(dimensions.z));
  const sliceCountPerRegionY = Math.ceil(dimensions.z / sliceCountPerRegionX);
  const voxelCountPerRegionX = sliceCountPerRegionX * dimensions.x;
  const voxelCountPerRegionY = sliceCountPerRegionY * dimensions.y;

  // Find the power of two that can fit all tile data, accounting for slices.
  // There's probably a non-iterative solution for this, but this is good enough for now.
  let textureDimension = CesiumMath.previousPowerOfTwo(
    Math.floor(Math.sqrt(voxelCountTotal))
  );
  for (;;) {
    const regionCountX = Math.floor(textureDimension / voxelCountPerRegionX);
    const regionCountY = Math.floor(textureDimension / voxelCountPerRegionY);
    const regionCount = regionCountX * regionCountY;
    if (regionCount >= tileCount) {
      break;
    } else {
      textureDimension *= 2;
    }
  }

  const pixelSizeInBytes =
    MetadataComponentType.getSizeInBytes(componentType) * channelCount;

  return pixelSizeInBytes * textureDimension ** 2;
};

/**
 * @param {Number} index
 * @param {Float32Array|Uint16Array|Uint8Array} data
 */
Megatexture.prototype.writeDataToTexture = function (index, data) {
  // Unsigned short textures not allowed in webgl 1, so treat as float
  const tileData =
    data.constructor === Uint16Array ? new Float32Array(data) : data;

  const {
    voxelCountPerTile,
    sliceCountPerRegion,
    voxelCountPerRegion,
    channelCount,
    tileVoxelDataTemp,
    regionCountPerMegatexture,
  } = this;

  for (let z = 0; z < voxelCountPerTile.z; z++) {
    const sliceVoxelOffsetX = (z % sliceCountPerRegion.x) * voxelCountPerTile.x;
    const sliceVoxelOffsetY =
      Math.floor(z / sliceCountPerRegion.x) * voxelCountPerTile.y;
    const readOffsetZ = z * voxelCountPerTile.y * voxelCountPerTile.x;
    for (let y = 0; y < voxelCountPerTile.y; y++) {
      const writeOffsetY = (sliceVoxelOffsetY + y) * voxelCountPerRegion.x;
      for (let x = 0; x < voxelCountPerTile.x; x++) {
        const readIndex = readOffsetZ + y * voxelCountPerTile.x + x;
        const writeIndex = writeOffsetY + sliceVoxelOffsetX + x;
        for (let c = 0; c < channelCount; c++) {
          tileVoxelDataTemp[writeIndex * channelCount + c] =
            tileData[readIndex * channelCount + c];
        }
      }
    }
  }

  const voxelOffsetX =
    (index % regionCountPerMegatexture.x) * voxelCountPerRegion.x;
  const voxelOffsetY =
    Math.floor(index / regionCountPerMegatexture.x) * voxelCountPerRegion.y;

  const source = {
    arrayBufferView: tileVoxelDataTemp,
    width: voxelCountPerRegion.x,
    height: voxelCountPerRegion.y,
  };

  const copyOptions = {
    source: source,
    xOffset: voxelOffsetX,
    yOffset: voxelOffsetY,
  };

  this.texture.copyFrom(copyOptions);
};

/**
 * Returns true if this object was destroyed; otherwise, false.
 * <br /><br />
 * If this object was destroyed, it should not be used; calling any function other than
 * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
 *
 * @returns {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
 *
 * @see Megatexture#destroy
 */
Megatexture.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
 * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
 * <br /><br />
 * Once an object is destroyed, it should not be used; calling any function other than
 * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
 * assign the return value (<code>undefined</code>) to the object as done in the example.
 *
 * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
 *
 * @see Megatexture#isDestroyed
 *
 * @example
 * megatexture = megatexture && megatexture.destroy();
 */
Megatexture.prototype.destroy = function () {
  this.texture = this.texture && this.texture.destroy();
  return destroyObject(this);
};

export default Megatexture;
