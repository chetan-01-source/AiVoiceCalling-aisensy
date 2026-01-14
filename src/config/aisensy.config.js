/**
 * AiSensy API Configuration
 */

const AISENSY_BASE_URL = "https://apis.aisensy.com/project-apis/v1";
const PROJECT_ID = process.env.AISENSY_PROJECT_ID;
const API_KEY = process.env.AISENSY_API_KEY;

const AISENSY_HEADERS = {
    "x-aisensy-project-api-pwd": API_KEY,
    "Content-Type": "application/json"
};

module.exports = {
    AISENSY_BASE_URL,
    PROJECT_ID,
    API_KEY,
    AISENSY_HEADERS
};
