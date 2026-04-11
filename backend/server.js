const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./database');
const apiRoutes = require('./routes/api');
const deployRoutes = require('./routes/deploy');
const socketHandler = require('./middleware/socketHandler');

const cookieParser = require('cookie-parser');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: config.SOCKET_PING_INTERVAL,
  pingTimeout: config.SOCKET_PING_TIMEOUT
});

app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => res.render('index.html'));

app.use('/api', apiRoutes(io));
app.use('/deploy', deployRoutes);

socketHandler(io);

const startServer = async () => {
  try {
    await db.initializeDatabase();
    server.listen(config.PORT, config.HOST, () => {
      console.log(`Server running on http://${config.HOST}:${config.PORT}`);
    });
    setInterval(db.cleanupOldMetrics, 3600000);
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
};

startServer();
