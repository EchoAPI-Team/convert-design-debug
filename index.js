const _ = require('lodash');
const JSON5 = require('json5');
const { toJsonSchema } = require('json2json-schema');
const MockSchema = require('apipost-mock-schema'),
    myMockSchema = new MockSchema();

// Map of data modes to their corresponding content types
const modeMap = {
    "urlencoded": "application/x-www-form-urlencoded",
    "form-data": "multipart/form-data",
    "binary": "application/octet-stream",
    "msgpack": "application/x-msgpack",
    "json": "application/json",
    "xml": "application/xml",
    "javascript": "application/javascript",
    "plain": "text/plain",
    "html": "text/html"
}

// Function to find differences in JSON objects
const diffJson = (source, dist, currentPath = '', diff = []) => {
    _.forEach(source, (item, key) => {
        const newPath = currentPath ? `${currentPath}.${key}` : key;

        // Check for differences in 'raw' string properties
        if (_.isString(item) && key === 'raw') {
            try {
                const itemJson = JSON5.parse(item);
                const distItemJson = JSON5.parse(_.get(dist, key, '{}'));

                // If keys differ, record the path
                if (!_.isEqual(_.keys(itemJson), _.keys(distItemJson))) {
                    diff.push(newPath);
                }
            } catch (e) { }
        }
        // Check for differences in 'parameter' arrays
        else if (_.isArray(item) && key === 'parameter') {
            const sourceKeys = _.keys(_.mapValues(_.keyBy(item, 'key'), 'value'));
            const distKeys = _.keys(_.mapValues(_.keyBy(_.get(dist, key, []), 'key'), 'value'));

            // If keys differ, record the path
            if (!_.isEqual(sourceKeys, distKeys)) {
                diff.push(newPath);
            }
        }
        // Recursively check for differences in objects
        else if (_.isPlainObject(item)) {
            diffJson(item, _.get(dist, key, {}), newPath, diff);
        }
    });
};

// Convert OpenAPI design to a debug request format
const design2debug = (openapi, format) => {
    return new Promise(async (resove, reject) => {
        // Find the URL parameter in OpenAPI paths
        const url = _.first(_.keys(_.get(openapi, 'paths')));
        if (!_.isString(url)) {
            reject(`Invalid OpenAPI format`)
        }

        // Find the method parameter in OpenAPI paths
        const method = _.first(_.keys(_.get(openapi, `paths['${url}']`)));
        if (!_.isString(method)) {
            reject(`Invalid OpenAPI format`)
        }

        // Prepare the request structure
        const request = {
            header: { "parameter": [] }, query: { "parameter": [] }, cookie: { "parameter": [] }, restful: { "parameter": [] }, body: {
                "mode": "none",
                "parameter": [],
                "raw": ""
            }
        };

        // Extract parameters from the OpenAPI definition
        const parameters = _.get(openapi, `paths['${url}'].${method}.parameters`);
        _.forEach(parameters, (item) => {
            if (['header', 'query', 'cookie', 'path'].indexOf(item?.in) > -1) {
                request[item?.in == 'path' ? 'restful' : item?.in].parameter.push({
                    "description": item?.description,
                    "field_type": _.capitalize(item?.schema?.type || 'String'),
                    "is_checked": item?.required ? 1 : -1,
                    "key": item?.name,
                    "value": item?.example,
                    "not_null": item?.required ? 1 : -1
                })
            }
        });

        // Determine the body mode from the format
        const mode = _.get(format, `request.body.mode`);

        if (mode == 'none') {
            // Map the mode to the appropriate content type if mode is 'none'
            _.set(request, 'body.mode', _.get(_.invert(modeMap), _.first(_.keys(_.get(openapi, `paths['${url}'].${method}.requestBody.content`)))));
        } else {
            _.set(request, 'body.mode', mode);
        }

        // Get the content schema from the OpenAPI definition
        const contentSchema = _.get(openapi, `paths['${url}'].${method}.requestBody.content['${modeMap[_.get(request, 'body.mode')]}'].schema`);
        const contentRaw = _.get(openapi, `paths['${url}'].${method}.requestBody.content['${modeMap[_.get(request, 'body.mode')]}'].example`);

        // Process the body based on its mode
        if (!_.isUndefined(contentSchema)) {
            switch (_.get(request, 'body.mode')) {
                case 'urlencoded':
                case 'form-data':
                    _.set(request, 'body.parameter', _.get(format, 'request.body.parameter') || []);

                    try {
                        const mockData = await myMockSchema.mock(contentSchema);
                        _.forEach(mockData, (value, key) => {
                            const existItemKey = _.findKey(_.get(request, 'body.parameter'), (item) => {
                                return item?.key == key;
                            })

                            if (!_.isUndefined(existItemKey)) {
                                // Update existing parameter value
                                _.set(request, `body.parameter[${_.toNumber(existItemKey)}].value`, value);
                            } else {
                                // Add new parameter with mock data
                                request.body.parameter.push({
                                    "description": '',
                                    "field_type": 'String',
                                    "is_checked": 1,
                                    "key": key,
                                    "value": value,
                                    "not_null": 1
                                })
                            }
                        })
                    } catch (e) { }
                    break;
                case 'binary':
                    // Set binary data for body
                    _.set(request, 'body.binary', _.get(format, 'request.body.binary') || null);
                    break;
                case 'msgpack':
                case 'json':
                    // Set raw body data
                    try {
                        const mockData = await myMockSchema.mock(contentSchema);

                        if (!_.isString(mockData)) {
                            _.set(request, 'body.raw', JSON.stringify(mockData, null, "\t") || '');
                        } else {
                            _.set(request, 'body.raw', mockData || '');
                        }

                    } catch (e) { }
                    break;
                case 'xml':
                case 'javascript':
                case 'plain':
                case 'html':
                default:
                    _.set(request, 'body.raw', contentRaw || '');
                    break;
            }
        }

        // Prepare the current request object
        const currentRequest = {
            url: format.url,
            method: format.method,
            request: {
                header: format.request?.header,
                query: format.request?.query,
                cookie: format.request?.cookie,
                body: format.request?.body
            }
        }

        // Find differences between current request and OpenAPI request
        const diff = []
        diffJson({ url, method: _.toUpper(method), request }, currentRequest, '', diff);
        resove({ url, method: _.toUpper(method), request, diff })
    })
}

// Recursive function to get OpenAPI parameters by key
const recursionGetOpenAPIPara = (openapi, findKey) => {
    let results = [];

    function recursiveSearch(currentObj) {
        _.forOwn(currentObj, (value, key) => {
            if (key === findKey) {
                results.push(value);
            } else if (_.isObject(value)) {
                // Recurse into objects
                recursiveSearch(value);
            }
        });
    }

    recursiveSearch(openapi);
    return results; // Return all found values
}

// Convert debug request format back to OpenAPI design
const debug2design = (openapi, format) => {
    const swagger = {};

    return new Promise(async (resove, reject) => {
        // Validate URL and method in the format
        if (!_.isString(format?.url) || !_.isString(format?.method) || _.isEmpty(format?.url) || _.isEmpty(format?.method)) {
            reject('Please set the url and method of the API first')
        }

        // Initialize the Swagger object structure
        swagger[format?.url] = {};
        _.set(swagger[format?.url], `${_.toLower(format?.method)}`, {})

        // Set parameters for the request
        const parameters = [], requestBody = {};
        ['header', 'query', 'cookie', 'restful'].forEach((type) => {
            // Map each specified parameter type
            _.forEach(_.get(format, `request.${type}.parameter`), (item) => {
                parameters.push({
                    "name": item?.key,
                    "in": type == 'restful' ? 'path' : type,
                    "description": item?.description,
                    "required": item?.not_null > 0 ? true : false,
                    "example": item?.value,
                    "schema": {
                        "type": _.toLower(item?.field_type),
                    }
                })
            })
        });

        // Merge parameters into the Swagger object, avoiding duplicates
        _.set(swagger[format?.url][_.toLower(format?.method)], `parameters`, _.values(_.merge({}, _.keyBy(_.first(recursionGetOpenAPIPara(openapi['paths'], 'parameters')), 'name'), _.keyBy(parameters, 'name'))))

        // Initialize requestBody
        // Using first found requestBody if exists
        _.set(swagger[format?.url][_.toLower(format?.method)], `requestBody`, _.first(recursionGetOpenAPIPara(openapi['paths'], 'requestBody')))

        // Construct new body schema based on mode
        const bodySchema = {};
        switch (_.get(format, 'request.body.mode')) {
            case 'urlencoded':
            case 'form-data':
                const schemaData = _.transform(_.get(format, 'request.body.parameter'), (acc, obj) => {
                    acc[obj.key] = obj.value;
                }, {}) || {};

                _.assign(bodySchema, toJsonSchema(schemaData))
                // TODO: Add required fields and descriptions
                break;
            case 'binary':
                _.assign(bodySchema, {
                    "type": "string",
                    "properties": {},
                    "format": "binary"
                })

                break;
            case 'msgpack':
            case 'json':
                try {
                    // Parse raw body for JSON schema conversion
                    _.assign(bodySchema, toJsonSchema(JSON5.parse(String(_.get(format, 'request.body.raw') || '{}'))))
                } catch (e) {
                    console.log(e)
                }
                break;
            case 'xml':
            case 'javascript':
            case 'plain':
            case 'html':
            default:
                // Default to string type for unsupported modes
                _.assign(bodySchema, {
                    "type": "string",
                    "properties": {},
                    "example": String(_.get(format, 'request.body.raw') || '')
                })
                break;
        }

        // Set the body schema into the Swagger object
        if (!_.isUndefined(modeMap[_.get(format, 'request.body.mode')])) {
            _.set(swagger[format?.url][_.toLower(format?.method)], `requestBody.content['${modeMap[_.get(format, 'request.body.mode')]}'].schema`, bodySchema)
        }

        // Retrieve original data from the OpenAPI definition
        const oldPath = _.first(_.keys(_.get(openapi, 'paths')))
        const oldMethod = _.first(_.keys(_.get(openapi, `paths['${oldPath}']`)))
        const finalSwagger = _.assign(_.get(openapi, `paths['${oldPath}'].${oldMethod}`), {
            parameters: swagger[format?.url][_.toLower(format?.method)]?.parameters || [],
            requestBody: swagger[format?.url][_.toLower(format?.method)]?.requestBody || []
        });

        // Create final OpenAPI structure with updated paths
        const finalOpenAPI = _.cloneDeep(_.omit(openapi, `paths['${oldPath}']`));
        _.set(finalOpenAPI, `paths['${format?.url}']['${_.toLower(format?.method)}']`, finalSwagger)
        resove(finalOpenAPI); // Return the modified OpenAPI definition
    })
}

// Export the design2debug and debug2design functions
module.exports = { design2debug, debug2design }