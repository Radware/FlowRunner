import { Handle, Position } from '@xyflow/react';

// Custom node mirroring the app's Drawflow node markup (flowVisualizer.js
// _getNodeHtml): header with icon + name + actions, a content line, and a
// runtime-details slot. The point of the spike is to show custom-node ergonomics
// are strictly better than Drawflow's innerHTML string templating: here it's a
// real component with typed props, event handlers, and token-driven styling.

const ICONS = {
    request: '→', // →
    condition: '❖', // ❖
    loop: '↻', // ↻
    transform: '⚙', // ⚙
};

function ContentLine({ content }) {
    switch (content.kind) {
        case 'request':
            return (
                <div className="node-content">
                    <span className={`request-method ${content.method}`}>{content.method}</span>{' '}
                    <code className="request-url" title={content.url}>
                        {content.url.length > 30 ? content.url.slice(0, 27) + '…' : content.url}
                    </code>
                </div>
            );
        case 'condition':
            return (
                <div className="node-content">
                    If: <code className="condition-code">{content.text}</code>
                </div>
            );
        case 'loop':
            return (
                <div className="node-content">
                    For <code>{content.variable}</code> in{' '}
                    <code title={content.source}>{content.source}</code>
                </div>
            );
        case 'transform':
            return (
                <div className="node-content">
                    Transform <code>{content.opCount} op(s)</code>
                </div>
            );
        default:
            return <div className="node-content">{content.text}</div>;
    }
}

export default function FlowStepNode({ id, data, selected }) {
    const roles = data.sourceRoles;
    // Distribute source handles across the bottom edge.
    const handleLeft = (i, n) => `${((i + 1) / (n + 1)) * 100}%`;

    return (
        <div
            className={`flow-node type-${data.stepType}${selected ? ' selected' : ''}`}
            data-step-id={id}
        >
            <Handle type="target" position={Position.Top} id="in" />
            <div className="flow-node-inner">
                <div className="node-header">
                    <span className="node-icon">{ICONS[data.stepType] || '■'}</span>
                    <span className="node-name">{data.label}</span>
                    <div className="node-actions">
                        <button
                            className="btn-node-action btn-delete-node"
                            title="Delete step"
                            onClick={(e) => {
                                e.stopPropagation();
                                data.onDeleteStep?.(id);
                            }}
                        >
                            {'×'}
                        </button>
                    </div>
                </div>
                <ContentLine content={data.content} />
                {data.runtime ? (
                    <div className={`node-runtime-details status-${data.runtime.status}`}>
                        {data.runtime.status}
                        {data.runtime.durationMs != null ? ` · ${data.runtime.durationMs}ms` : ''}
                    </div>
                ) : null}
            </div>
            {roles.map((role, i) => (
                <Handle
                    key={role}
                    type="source"
                    position={Position.Bottom}
                    id={role}
                    style={{ left: handleLeft(i, roles.length) }}
                    title={role}
                />
            ))}
        </div>
    );
}
