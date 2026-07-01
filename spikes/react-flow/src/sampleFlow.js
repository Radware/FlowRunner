// A trimmed copy of httpbin-flow.flow.json's structure, embedded so the spike is
// self-contained (no fs access, no need to reach into the repo root). Exercises
// every branching case: request, condition (then/else), loop, nested condition.
export const sampleFlow = {
    id: 'flow_spike_demo',
    name: 'React Flow spike demo',
    steps: [
        {
            id: 'step_1_get_ip',
            name: 'Get IP & Headers',
            type: 'request',
            method: 'GET',
            url: '{{baseUrl}}/get?run={{randomNumber}}',
            onFailure: 'stop',
        },
        {
            id: 'step_2_check_status',
            name: 'Status OK?',
            type: 'condition',
            conditionData: { variable: 'statusCode', operator: 'equals', value: '200' },
            then: [
                {
                    id: 'step_3_post',
                    name: 'POST echo data',
                    type: 'request',
                    method: 'POST',
                    url: '{{baseUrl}}/post',
                    onFailure: 'stop',
                },
                {
                    id: 'step_4_loop',
                    name: 'Loop over items',
                    type: 'loop',
                    loopVariable: 'item',
                    source: 'body.items',
                    steps: [
                        {
                            id: 'step_5_get_uuid',
                            name: 'Get UUID',
                            type: 'request',
                            method: 'GET',
                            url: '{{baseUrl}}/uuid',
                            onFailure: 'continue',
                        },
                    ],
                },
            ],
            else: [
                {
                    id: 'step_6_report',
                    name: 'Report failure',
                    type: 'transform',
                    ops: [{ op: 'set' }, { op: 'map' }],
                },
            ],
        },
    ],
};
