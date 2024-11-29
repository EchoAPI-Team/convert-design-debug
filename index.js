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
            header: { "parameter": [] }, query: { "parameter": [] }, cookie: { "parameter": [] }, body: {
                "mode": "none",
                "parameter": [],
                "raw": ""
            }
        };
        
        // Extract parameters from the OpenAPI definition
        const parameters = _.get(openapi, `paths['${url}'].${method}.parameters`);
        _.forEach(parameters, (item) => {
            if (['header', 'query', 'cookie'].indexOf(item?.in) > -1) {
                request[item?.in].parameter.push({
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
                                _.set(request, `body.parameter.${existItemKey}.value`, value);
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
                case 'xml':
                case 'javascript':
                case 'plain':
                case 'html':
                default:
                    // Set raw body data
                    _.set(request, 'body.raw', _.get(format, 'request.body.raw') || '');
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
        ['header', 'query', 'cookie'].forEach((type) => {
            // Map each specified parameter type
            _.forEach(_.get(format, `request.${type}.parameter`), (item) => {
                parameters.push({
                    "name": item?.key,
                    "in": type,
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
        _.set(swagger[format?.url][_.toLower(format?.method)], `requestBody.content['${modeMap[_.get(format, 'request.body.mode')]}'].schema`, bodySchema)

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



const openapi = { "info": { "title": "Local Project", "description": "", "version": "1.0.0" }, "openapi": "3.0.3", "servers": [{ "variables": { "a": { "default": "123", "description": "" } }, "url": "", "description": "Default" }], "paths": { "www.baidu.com": { "post": { "summary": "HTTP Request", "description": "", "tags": [], "parameters": [{ "name": "h1", "in": "header", "description": "", "required": true, "example": "1", "schema": { "type": "string" } }, { "name": "h2", "in": "header", "description": "", "required": true, "example": "2", "schema": { "type": "string" } }, { "name": "q1", "in": "query", "description": "", "required": true, "example": "1", "schema": { "type": "string" }, "key": "q1" }, { "name": "q2", "in": "query", "description": "", "required": true, "example": "2", "schema": { "type": "string" }, "key": "q2" }], "requestBody": { "content": { "multipart/form-data": { "schema": { "type": "object", "properties": { "b2": { "type": "string", "mock": { "mock": "2" } }, "b1": { "type": "string" } }, "ECHOAPI_ORDERS": ["b1", "b2"], "required": [] } }, "application/json": { "schema": { "type": "object", "properties": { "data": { "type": "object", "properties": { "title": { "type": "string", "mock": { "mock": "@ctitle" } } }, "ECHOAPI_ORDERS": ["title"], "required": [] } }, "ECHOAPI_ORDERS": ["data"], "required": [] } } } }, "responses": { "200": { "description": "Success", "content": { "application/json": { "schema": { "type": "object", "properties": { "data": { "type": "object", "properties": { "id": { "type": "string", "mock": { "mock": "@guid" } } }, "ECHOAPI_ORDERS": ["id"], "required": [] } }, "ECHOAPI_ORDERS": ["data"], "required": [] }, "example": "{\n\t\"data\": {\n\t\t\"id\": \"6cb750b4-63da-4592-a405-5934d48d1d65\"\n\t}\n}" } } }, "404": { "description": "Failure", "content": { "application/json": { "schema": { "type": "object", "properties": { "data": { "type": "object", "properties": { "code": { "type": "number", "mock": { "mock": "1000" } } }, "ECHOAPI_ORDERS": ["code"], "required": [] } }, "ECHOAPI_ORDERS": ["data"], "required": [] }, "example": "" } } } } } } } };

const format = {
    "method": "POST",
    "url": "https://rest.echoapi.com/users?debugp1=c",
    "request": {
        "body": {
            "mode": "form-data",
            "parameter": [
                {
                    "description": "",
                    "field_type": "String",
                    "is_checked": 1,
                    "key": "debugbu",
                    "value": "o",
                    "not_null": 1,
                    "param_id": "11bd0715ba7005"
                }
            ],
            "raw": "{\n\t\"id\": 0,\n\t\"username\": \"echo api\",\n\t\"firstName\": \"Echo\",\n\t\"lastName\": \"Api\",\n\t\"email\": \"support@echoapi.com\",\n\t\"password\": \"12345\",\n\t\"phone\": \"\",\n\t\"userStatus\": 0\n}",
            "raw_parameter": [
                {
                    "param_id": "233af7b7fc5028",
                    "description": "",
                    "field_type": "Integer",
                    "is_checked": 1,
                    "key": "id",
                    "not_null": -1,
                    "value": ""
                },
                {
                    "param_id": "233af7b7fc5029",
                    "description": "",
                    "field_type": "String",
                    "is_checked": 1,
                    "key": "username",
                    "not_null": -1,
                    "value": ""
                },
                {
                    "param_id": "233af7b7fc502a",
                    "description": "",
                    "field_type": "String",
                    "is_checked": 1,
                    "key": "firstName",
                    "not_null": -1,
                    "value": ""
                },
                {
                    "param_id": "233af7b7fc502b",
                    "description": "",
                    "field_type": "String",
                    "is_checked": 1,
                    "key": "lastName",
                    "not_null": -1,
                    "value": ""
                },
                {
                    "param_id": "233af7b7fc502c",
                    "description": "",
                    "field_type": "String",
                    "is_checked": 1,
                    "key": "email",
                    "not_null": -1,
                    "value": ""
                },
                {
                    "param_id": "233af7b7fc502d",
                    "description": "",
                    "field_type": "String",
                    "is_checked": 1,
                    "key": "password",
                    "not_null": -1,
                    "value": ""
                },
                {
                    "param_id": "233af7b7fc502e",
                    "description": "",
                    "field_type": "String",
                    "is_checked": 1,
                    "key": "phone",
                    "not_null": -1,
                    "value": ""
                },
                {
                    "param_id": "233af7b7fc502f",
                    "description": "",
                    "field_type": "Integer",
                    "is_checked": 1,
                    "key": "userStatus",
                    "not_null": -1,
                    "value": ""
                }
            ],
            "raw_schema": {
                "type": "object",
                "required": [
                    "username"
                ],
                "properties": {
                    "id": {
                        "type": "integer"
                    },
                    "email": {
                        "type": "string"
                    },
                    "phone": {
                        "type": "string"
                    },
                    "lastName": {
                        "type": "string"
                    },
                    "password": {
                        "type": "string"
                    },
                    "username": {
                        "type": "string",
                        "description": "user name"
                    },
                    "firstName": {
                        "type": "string"
                    },
                    "userStatus": {
                        "type": "integer"
                    }
                },
                "ECHOAPI_REFS": {},
                "ECHOAPI_ORDERS": [
                    "id",
                    "username",
                    "firstName",
                    "lastName",
                    "email",
                    "password",
                    "phone",
                    "userStatus"
                ]
            },
            "binary": null
        },
        "header": {
            "parameter": [
                {
                    "description": "",
                    "field_type": "String",
                    "is_checked": 1,
                    "key": "debugh1",
                    "value": "a",
                    "not_null": 1,
                    "param_id": "11bcf3dbfa7000"
                },
                {
                    "description": "",
                    "field_type": "String",
                    "is_checked": 1,
                    "key": "debugh2",
                    "value": "b",
                    "not_null": 1,
                    "param_id": "11bcf4fffa7001"
                }
            ]
        },
        "query": {
            "query_add_equal": 1,
            "parameter": [
                {
                    "description": "",
                    "field_type": "String",
                    "is_checked": 1,
                    "key": "debugp1",
                    "value": "c",
                    "not_null": 1,
                    "param_id": "11bcfd363a7003"
                }
            ]
        },
        "cookie": {
            "parameter": []
        },
        "restful": {
            "parameter": []
        }
    }
};
design2debug(openapi, format).then((res) => {
    console.log(res)
}).catch((e) => {
    console.log(e)
});

debug2design(openapi, format).then((res) => {
    console.log(res)
}).catch((e) => {
    console.log(e)
});