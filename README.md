# convert-design-debug

## Overview

`convert-design-debug` is a utility package designed for converting OpenAPI specifications into a debug request format and vice versa. It leverages various libraries, including Lodash for object manipulation, JSON5 for relaxed JSON parsing, and `apipost-mock-schema` for generating mock data.

## Features

- **OpenAPI to Debug Request Conversion**: Easily transform OpenAPI definitions into a structured request format for debugging purposes.
- **Debug Request to OpenAPI Conversion**: Convert formatted request data back into an OpenAPI specification.
- **JSON Difference Detection**: Identify differences between JSON objects at various nesting levels.
- **Mock Data Generation**: Automatically generate mock data based on API parameter definitions.

## Installation

You can install the package via npm:

```bash
npm install convert-design-debug
```

## Usage

### Functions

1. **`design2debug(openapi, format)`**

   Converts an OpenAPI definition into a debug request format.

   - **Parameters**:
     - `openapi`: The OpenAPI specification object.
     - `format`: The structure defining how the request should be formatted.

   - **Returns**: A promise that resolves to the formatted request object.

   **Example**:

   ```javascript
   const { design2debug } = require('convert-design-debug');

   design2debug(openapi, format).then(response => {
       console.log(response);
   }).catch(error => {
       console.error(error);
   });
   ```

2. **`debug2design(openapi, format)`**

   Converts a debug formatted request back into an OpenAPI specification.

   - **Parameters**:
     - `openapi`: The original OpenAPI specification object.
     - `format`: The structured request format.

   - **Returns**: A promise that resolves to the modified OpenAPI definition.

   **Example**:

   ```javascript
   const { debug2design } = require('convert-design-debug');

   debug2design(openapi, format).then(updatedOpenAPI => {
       console.log(updatedOpenAPI);
   }).catch(error => {
       console.error(error);
   });
   ```

### Example Scenario

Below is an example of how to use the provided functions with predefined OpenAPI and request format objects:

```javascript
const { design2debug, debug2design } = require('convert-design-debug');
const openapi = { /* Your OpenAPI object */ };
const format = { /* Your request format object */ };

// Convert OpenAPI to Debug Request
design2debug(openapi, format)
    .then(res => console.log(res))
    .catch(err => console.error(err));

// Convert Debug Request back to OpenAPI
debug2design(openapi, format)
    .then(res => console.log(res))
    .catch(err => console.error(err));
```

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Contributing

Feel free to fork this repository and submit pull requests. If you encounter any issues, please file them on the issues page.