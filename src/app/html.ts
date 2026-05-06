import { APP_STYLES } from "./web/styles.js";

export const EMBEDDED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>myAgent</title>
<link rel="icon" href="data:,">
<style>${APP_STYLES}</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="/assets/client.js"></script>
</body>
</html>`;
