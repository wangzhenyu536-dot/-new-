import { Fragment } from 'react';
export function Lines({ text }: { text: string }) { return <>{text.split('\n').map((line, index) => <Fragment key={index}>{index > 0 && <br />}{line}</Fragment>)}</>; }
