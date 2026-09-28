const path = require('node:path');

module.exports = {
  mode: 'production',
  entry: './src/main.js',
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, 'build/webpack'),
    filename: '[name].js',
    chunkFilename: '[name].js',
    publicPath: '/webpack/',
    clean: true,
  },
};
