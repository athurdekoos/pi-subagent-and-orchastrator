/**
 * Mock for @mariozechner/pi-tui
 */
export class Text {
	constructor(
		public text: string,
		public x: number,
		public y: number,
	) {}
}

export class Container {
	children: unknown[] = [];
	constructor(...args: unknown[]) {}
}

export class Markdown {
	constructor(
		public content: string,
		public x: number,
		public y: number,
	) {}
}

export class Spacer {
	constructor(public height: number = 1) {}
}
