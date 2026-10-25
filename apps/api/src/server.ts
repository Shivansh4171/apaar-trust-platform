import { apiEnvironment } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(apiEnvironment.API_PORT, () => {
  console.info(`APAAR API listening at http://localhost:${apiEnvironment.API_PORT}`);
});
