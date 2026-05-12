.PHONY: build mac linux win clean

build:
	npm run build

mac:
	npm run build:mac

linux:
	npm run build:linux

win:
	npm run build:win

clean:
	rm -rf dist
