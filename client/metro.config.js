const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Optimization: Skip certain modules, faster bundling
config.transformer = {
  ...config.transformer,
  minifierPath: 'metro-minify-terser',
  minifierConfig: {
    compress: {
      // Faster compression
      passes: 1,
    },
  },
};

// Cache optimization
config.cacheVersion = '1';

module.exports = config;
