const express = require("express");
const hbengine = require("express-handlebars");
const bodyParser = require("body-parser");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const hb = hbengine.create();

const port = 3000;
const app = express();
const client = axios.create({
    headers: { "Content-Type": "application/json" },
});
const wss = new WebSocketServer({ port: 8080 });

let unsubscribeLink;
let socket;
let data = [];

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.engine(
    "hbs",
    hbengine.engine({
        defaultLayout: "main",
        extname: ".hbs",
    })
);
app.set("view engine", "hbs");
app.set("trust proxy", true);

// Logger middleware
app.use((req, res, next) => {
    const requestId = crypto.randomUUID().slice(0, 8);
    var send = res.send;
    res.send = function (body) {
        log(`[request-${requestId}] << ${res.statusCode} ${body !== undefined ? JSON.stringify(body) : ""}`);
        send.call(this, body);
    };
    const ip = req.protocol + "://" + req.get("host") + req.originalUrl;
    log(`[request-${requestId}] >> [${req.method}] ${ip} ${JSON.stringify(req.body)}`);
    next();
});

app.get("/", (req, res) => {
    res.render("home");
});

app.post("/connect", (request, res) => {
    const path = request.body.path;

    if (!unsubscribeLink) {
        const uuid = crypto.randomUUID();
        subscribe(path, uuid)
            .then((data) => {
                unsubscribeLink = data.unsubscribeLink;
                res.status(200).send();
            })
            .catch((err) => {
                res.status(500).send();
            });
    } else {
        res.status(200).send();
    }
});

app.delete("/disconnect", (req, res) => {
    disconnect()
        .then(() => {
            res.status(204).send();
        })
        .catch((err) => {
            console.error("Unable to unsubscribe");
            res.status(500).send();
        });
});

app.post("/webhook-event/:uuid", (req, res) => {
    data.push(req.body.data);
    if (socket) {
        sendEvents();
    }
    res.status(204).send();
});

app.delete("/clear", (req, res) => {
    data = [];
    if (socket) {
        sendEvents();
    }
    res.status(204).send();
});

app.listen(port, () => {
    log(`You can access application on http://localhost:${port}`);
});

wss.on("connection", function connection(ws) {
    const uuid = crypto.randomUUID();
    log(`Client connected on websocket: ${uuid}`);
    socket = ws;

    ws.on("error", console.error);
    ws.on("message", function message(data) {
        log(`received: ${data}`);
    });
    ws.on("close", () => {
        socket = undefined;
        log(`Websocket close for client: ${uuid}`);
    });

    sendEvents();
});

const log = (data) => console.log(`${new Date().toLocaleString()} : ${data}`);

async function subscribe(path, uuid) {
    const data = {
        notifyUrl: `http://127.0.0.1:${port}/webhook-event/${uuid}`,
    };
    try {
        const response = await client.post(path, data);
        return response.data;
    } catch {
        log("Unable to subscribe");
    }
}

async function disconnect() {
    try {
        axios.delete(unsubscribeLink);
        return;
    } catch {
        log("Unable to unsubscribe");
    }
}

async function sendEvents() {
    hb.render("views/data.hbs", { rows: data })
        .then((renderedHtml) => {
            socket.send(renderedHtml);
        })
        .catch((err) => console.error(err));
}
