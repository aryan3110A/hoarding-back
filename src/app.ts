import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import routes from './routes';
import { config } from './config';
import { errorHandler } from './middleware/error.middleware';
import { rateLimit } from './middleware/rateLimit.middleware';

const app = express();

// Global Middleware
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = [...config.allowedOrigins, 'https://hoarding-front.vercel.app'];
      if (allowed.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files (uploaded images)
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

// Rate Limiting - More lenient for development (1000 requests per 15 minutes)
app.use(rateLimit(1000, 15 * 60));

// Routes
app.use('/api', routes);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Error Handling
app.use(errorHandler);

export default app;
