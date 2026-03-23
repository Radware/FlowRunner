// ========== FILE: harExporter.js ==========
// Module for generating HAR (HTTP Archive) format from flow execution results

import { findStepById } from './flowCore.js';

/**
 * Converts an object of headers to HAR format array
 * @param {Object} headersObj - Headers as key-value pairs
 * @returns {Array} - Headers in HAR format [{ name, value }, ...]
 */
function headersToHARFormat(headersObj) {
    if (!headersObj || typeof headersObj !== 'object') {
        return [];
    }
    return Object.entries(headersObj).map(([name, value]) => ({
        name: name,
        value: String(value)
    }));
}

/**
 * Gets HTTP status text from status code
 * @param {number} statusCode - HTTP status code
 * @returns {string} - Status text (e.g., "OK", "Not Found")
 */
function getStatusText(statusCode) {
    const statusTexts = {
        100: 'Continue',
        101: 'Switching Protocols',
        200: 'OK',
        201: 'Created',
        202: 'Accepted',
        203: 'Non-Authoritative Information',
        204: 'No Content',
        205: 'Reset Content',
        206: 'Partial Content',
        300: 'Multiple Choices',
        301: 'Moved Permanently',
        302: 'Found',
        303: 'See Other',
        304: 'Not Modified',
        307: 'Temporary Redirect',
        308: 'Permanent Redirect',
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        405: 'Method Not Allowed',
        406: 'Not Acceptable',
        408: 'Request Timeout',
        409: 'Conflict',
        410: 'Gone',
        413: 'Payload Too Large',
        414: 'URI Too Long',
        415: 'Unsupported Media Type',
        429: 'Too Many Requests',
        500: 'Internal Server Error',
        501: 'Not Implemented',
        502: 'Bad Gateway',
        503: 'Service Unavailable',
        504: 'Gateway Timeout'
    };
    return statusTexts[statusCode] || 'Unknown';
}

/**
 * Parses query string from URL
 * @param {string} url - Full URL
 * @returns {Array} - Query parameters in HAR format [{ name, value }, ...]
 */
function parseQueryString(url) {
    try {
        const urlObj = new URL(url);
        const params = [];
        urlObj.searchParams.forEach((value, name) => {
            params.push({ name, value });
        });
        return params;
    } catch (error) {
        return [];
    }
}

/**
 * Gets MIME type from headers
 * @param {Object} headers - Headers object
 * @returns {string} - MIME type or 'text/plain' as default
 */
function getMimeType(headers) {
    if (!headers) return 'text/plain';

    const contentType = Object.entries(headers).find(
        ([key]) => key.toLowerCase() === 'content-type'
    );

    if (contentType && contentType[1]) {
        const mimeType = contentType[1].split(';')[0].trim();
        return mimeType;
    }

    return 'text/plain';
}

/**
 * Generates a HAR file structure from execution results
 * @param {Array} executionResults - Array of step execution results from appState
 * @param {Object} flowModel - The current flow model containing step configurations
 * @returns {Object} - HAR format object
 */
export function generateHAR(executionResults, flowModel) {
    if (!Array.isArray(executionResults)) {
        throw new Error('executionResults must be an array');
    }

    if (!flowModel || !flowModel.steps) {
        throw new Error('flowModel must contain steps array');
    }

    // Filter for request steps that have valid output
    const requestResults = executionResults.filter(result => {
        if (!result || !result.stepId) return false;

        // Find the step in the flow model
        const step = findStepById(flowModel.steps, result.stepId);
        if (!step || step.type !== 'request') return false;

        // Include if we have output (response data)
        return result.output && typeof result.output === 'object' &&
               result.output.status !== undefined;
    });

    // Build HAR entries
    const entries = requestResults.map(result => {
        const step = findStepById(flowModel.steps, result.stepId);
        const output = result.output;

        // Build request object
        const method = step.method || 'GET';
        const url = step.url || '';
        const requestHeaders = step.headers || {};
        const requestBody = step.body;

        const harRequest = {
            method: method,
            url: url,
            httpVersion: 'HTTP/1.1',
            headers: headersToHARFormat(requestHeaders),
            queryString: parseQueryString(url),
            headersSize: -1,
            bodySize: -1
        };

        // Add postData if body exists and method supports it
        if (requestBody && !['GET', 'HEAD'].includes(method.toUpperCase())) {
            const requestMimeType = getMimeType(requestHeaders);
            const bodyText = typeof requestBody === 'string'
                ? requestBody
                : JSON.stringify(requestBody);

            harRequest.postData = {
                mimeType: requestMimeType,
                text: bodyText
            };
        }

        // Build response object
        const responseStatus = output.status;
        const responseHeaders = output.headers || {};
        const responseBody = output.body;

        const responseMimeType = getMimeType(responseHeaders);
        const responseText = responseBody !== null && responseBody !== undefined
            ? (typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody))
            : '';

        const harResponse = {
            status: responseStatus,
            statusText: getStatusText(responseStatus),
            httpVersion: 'HTTP/1.1',
            headers: headersToHARFormat(responseHeaders),
            content: {
                size: responseText.length,
                mimeType: responseMimeType,
                text: responseText
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: responseText.length
        };

        // Build HAR entry
        return {
            startedDateTime: new Date().toISOString(),
            time: 0, // No timing data available in current implementation
            request: harRequest,
            response: harResponse,
            cache: {},
            timings: {
                send: 0,
                wait: 0,
                receive: 0
            }
        };
    });

    // Build complete HAR structure
    const har = {
        log: {
            version: '1.2',
            creator: {
                name: 'FlowRunner',
                version: '1.2.1'
            },
            entries: entries
        }
    };

    return har;
}
