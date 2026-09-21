import { describe, expect, it } from 'vitest';
import { FontFile } from '../src/fonts/fontFile.js';
import { detectFormat } from '../src/fonts/sfnt/magic.js';
import { SfntCollection } from '../src/fonts/sfnt/collection.js';
import { SfntFont } from '../src/fonts/sfnt/sfntFont.js';
import { makeOtf, makeTtc, makeTtf } from './helpers/index.js';

describe('font format detection', () => {
  it('detects formats from magic bytes', () => {
    expect(detectFormat(makeTtf({ family: 'X' }))).toBe('ttf');
    expect(detectFormat(makeOtf({ family: 'X' }))).toBe('otf');
    expect(detectFormat(makeTtc([{ family: 'X' }]))).toBe('ttc');
    expect(detectFormat(Buffer.from('wOFF', 'ascii'))).toBe('woff');
    expect(detectFormat(Buffer.from('wOF2', 'ascii'))).toBe('woff2');
    expect(detectFormat(Buffer.from('nope'))).toBeNull();
  });
});

describe('SfntFont name table parsing', () => {
  it('extracts the standard name ids', () => {
    const font = new SfntFont(
      makeTtf({
        family: 'Overpass',
        subfamily: 'Regular',
        fullName: 'Overpass Regular',
        postScript: 'Overpass-Regular',
        version: '3.0.4',
      }),
    );
    expect(font.familyName()).toBe('Overpass');
    expect(font.subfamilyName()).toBe('Regular');
    expect(font.fullName()).toBe('Overpass Regular');
    expect(font.postScriptName()).toBe('Overpass-Regular');
    expect(font.version()).toBe('3.0.4');
    expect(font.isVariable()).toBe(false);
  });

  it('extracts preferred names and variable axes', () => {
    const font = new SfntFont(
      makeTtf(
        { family: 'Sometype', subfamily: 'Regular', preferredFamily: 'Sometype Mono', preferredSubfamily: 'Regular' },
        [{ tag: 'wght' }],
      ),
    );
    expect(font.preferredFamilyName()).toBe('Sometype Mono');
    expect(font.preferredSubfamilyName()).toBe('Regular');
    expect(font.isVariable()).toBe(true);
    expect(font.variableAxes().map((axis) => axis.tag)).toEqual(['wght']);
    expect(font.variableAxes()[0]!.defaultValue).toBeCloseTo(400);
    expect(font.variableAxes()[0]!.maxValue).toBeCloseTo(700);
  });

  it('rejects garbage binaries', () => {
    expect(() => new SfntFont(Buffer.alloc(8)).validate()).toThrow();
  });
});

describe('SfntCollection', () => {
  it('resolves faces by index', () => {
    const collection = new SfntCollection(
      makeTtc([
        { family: 'Face One', subfamily: 'Regular', fullName: 'Face One' },
        { family: 'Face Two', subfamily: 'Bold', fullName: 'Face Two Bold' },
      ]),
    );
    expect(collection.faceCount()).toBe(2);
    expect(collection.face(0).familyName()).toBe('Face One');
    expect(collection.face(1).familyName()).toBe('Face Two');
    expect(collection.face(1).subfamilyName()).toBe('Bold');
  });

  it('raises on out-of-range indexes', () => {
    const collection = new SfntCollection(makeTtc([{ family: 'Only' }]));
    expect(() => collection.face(3)).toThrow();
  });
});

describe('FontFile facade', () => {
  it('loads a ttf file with metadata', async () => {
    const font = FontFile.fromBytes(makeTtf({ family: 'Inter', subfamily: 'Bold' }), 'Inter-Bold.ttf');
    expect(font.format).toBe('ttf');
    expect(font.familyName).toBe('Inter');
    expect(font.subfamilyName).toBe('Bold');
    expect(font.collectionIndex).toBeNull();
  });

  it('loads the requested face of a collection', () => {
    const font = FontFile.fromBytes(
      makeTtc([{ family: 'A' }, { family: 'B' }]),
      'combined.ttc',
      { collectionIndex: 1 },
    );
    expect(font.familyName).toBe('B');
    expect(font.collectionIndex).toBe(1);
  });

  it('rejects unknown formats and woff2 with a clear error', () => {
    expect(() => FontFile.fromBytes(Buffer.from('garbage!'), 'x.ttf')).toThrow(/Unknown font format/);
    expect(() => FontFile.fromBytes(Buffer.from('wOF2....'), 'x.woff2')).toThrow(/WOFF2/);
  });
});
