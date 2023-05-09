import Check from "./Check.js";
import defaultValue from "./defaultValue.js";
import defined from "./defined.js";
import Resource from "./Resource.js";

/**
 * Construct an ImageBitmap from a Uint8Array
 * @private
 *
 * @param {object} options An object with the following properties
 * @param {Uint8Array} options.uint8Array A TypedArray containing data for the image pixels
 * @param {string} options.format The MIME type of the data
 * @param {Request} [options.request]
 * @param {boolean} [options.flipY=false]
 * @param {boolean} [options.skipColorSpaceConversion=false]
 * @returns {Promise<ImageBitmap>}
 */
function loadImageFromTypedArray(options) {
  const { uint8Array, format, request } = options;
  const flipY = defaultValue(options.flipY, false);
  const skipColorSpaceConversion = defaultValue(
    options.skipColorSpaceConversion,
    false
  );
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.object("uint8Array", uint8Array);
  Check.typeOf.string("format", format);
  //>>includeEnd('debug');

  const blob = new Blob([uint8Array], {
    type: format,
  });

  let blobUrl;
  return Resource.supportsImageBitmapOptions()
    .then(function (result) {
      if (result) {
        return Promise.resolve(
          Resource.createImageBitmapFromBlob(blob, {
            flipY: flipY,
            premultiplyAlpha: false,
            skipColorSpaceConversion: skipColorSpaceConversion,
          })
        );
      }

      blobUrl = window.URL.createObjectURL(blob);
      const resource = new Resource({
        url: blobUrl,
        request: request,
      });

      return resource.fetchImage({
        flipY: flipY,
        skipColorSpaceConversion: skipColorSpaceConversion,
      });
    })
    .then(function (result) {
      if (defined(blobUrl)) {
        window.URL.revokeObjectURL(blobUrl);
      }
      return result;
    })
    .catch(function (error) {
      if (defined(blobUrl)) {
        window.URL.revokeObjectURL(blobUrl);
      }
      return Promise.reject(error);
    });
}

export default loadImageFromTypedArray;
