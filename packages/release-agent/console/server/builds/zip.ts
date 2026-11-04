/**
 * Reads one file out of a zip, by its exact path.
 *
 * Uses yauzl rather than `unzip -p`, because unzip treats `*`, `?` and `[` in
 * the path as wildcards. Reading stops at `maxBytes`, so a large or hostile
 * entry cannot exhaust memory.
 */

import yauzl from 'yauzl';

export interface ZipEntryData {
	data: Buffer;
	/** The entry's full uncompressed size. */
	size: number;
	/** True when only the first `maxBytes` were read. */
	truncated: boolean;
}

export function readZipEntry( zipPath: string, entryPath: string, maxBytes: number ): Promise<ZipEntryData | null> {
	return new Promise( ( resolve, reject ) => {
		yauzl.open( zipPath, { lazyEntries: true, autoClose: false, strictFileNames: false }, ( openError, zip ) => {
			if ( openError || ! zip ) {
				reject( openError ?? new Error( 'Could not open the zip.' ) );
				return;
			}

			let settled = false;
			const finish = ( error: Error | null, value: ZipEntryData | null = null ) => {
				if ( settled ) {
					return;
				}

				settled = true;
				zip.close();

				if ( error ) {
					reject( error );
				} else {
					resolve( value );
				}
			};

			zip.on( 'error', ( error ) => finish( error ) );
			zip.on( 'end', () => finish( null, null ) );
			zip.on( 'entry', ( entry: yauzl.Entry ) => {
				if ( entry.fileName !== entryPath || entry.fileName.endsWith( '/' ) ) {
					zip.readEntry();
					return;
				}

				zip.openReadStream( entry, ( streamError, stream ) => {
					if ( streamError || ! stream ) {
						finish( streamError ?? new Error( 'Could not read that file.' ) );
						return;
					}

					const chunks: Buffer[] = [];
					let length = 0;
					let truncated = false;

					stream.on( 'data', ( chunk: Buffer ) => {
						if ( length + chunk.length > maxBytes ) {
							chunks.push( chunk.subarray( 0, maxBytes - length ) );
							length = maxBytes;
							truncated = true;
							stream.destroy();
							finish( null, { data: Buffer.concat( chunks ), size: entry.uncompressedSize, truncated } );
							return;
						}

						chunks.push( chunk );
						length += chunk.length;
					} );
					stream.on( 'error', ( error ) => finish( error ) );
					stream.on( 'end', () => finish( null, { data: Buffer.concat( chunks ), size: entry.uncompressedSize, truncated } ) );
				} );
			} );

			zip.readEntry();
		} );
	} );
}

/** True when the bytes look like binary data rather than text. */
export function looksBinary( data: Buffer ): boolean {
	return data.subarray( 0, 8000 ).includes( 0 );
}
