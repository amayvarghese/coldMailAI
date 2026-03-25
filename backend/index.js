import { createApp } from './app.js';
import { getCapabilities } from './email.js';

const PORT = process.env.PORT || 3001;
const app = createApp();

app.listen(PORT, () => {
  const { provider, autoTracking } = getCapabilities();
  console.log(
    `Cold email API listening on http://localhost:${PORT} (email: ${provider}, autoTracking: ${autoTracking})`
  );
});
