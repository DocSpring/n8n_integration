const { src, dest } = require('gulp');

function buildIcons() {
	src('nodes/**/*.{png,svg}').pipe(dest('dist/nodes'));
	return src('credentials/**/*.{png,svg}').pipe(dest('dist/credentials'));
}

exports['build:icons'] = buildIcons;
