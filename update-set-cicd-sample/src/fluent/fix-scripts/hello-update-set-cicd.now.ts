import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['hello-update-set-cicd-fix-script'],
    table: 'sys_script_fix',
    data: {
        name: 'Hello Update Set CICD',
        description: 'Sample fix script used to verify the update set CI/CD flow.',
        before: false,
        unloadable: false,
        record_for_rollback: true,
        script: Now.include('../../server/fix-scripts/hello-update-set-cicd.js'),
    },
})
