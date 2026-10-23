<?php
// Run inside the existing Coolify container after the data volume is prepared.
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$commit = $argv[1] ?? '';
if (! preg_match('/^[a-f0-9]{40}$/', $commit)) {
    throw new RuntimeException('A full reviewed Git commit is required.');
}
$application = App\Models\Application::where('uuid', '7kp3ukvu9u8z8cu2anhcgdrh')->firstOrFail();
if ($application->git_repository !== 'worobi/velvetgrimore.xyz') {
    throw new RuntimeException('Unexpected application source.');
}
$application->ports_exposes = '8080';
$application->health_check_enabled = true;
$application->health_check_path = '/api/health';
$application->health_check_port = '8080';
$application->health_check_type = 'cmd';
$application->health_check_command = 'node /app/scripts/health.js';
$application->health_check_start_period = 10;
$application->health_check_interval = 10;
$application->health_check_timeout = 5;
$application->health_check_retries = 6;
$application->health_check_return_code = 200;
$application->fqdn = 'https://velvetgrimore.xyz,https://www.velvetgrimore.xyz';
$application->git_branch = 'main';
$application->git_commit_sha = 'HEAD';
$application->save();
$labels = generateLabelsApplication($application->fresh());
foreach ($labels as $label) {
    if (preg_match('/^traefik\.http\.routers\.([^.]+)\.entryPoints=https$/', $label, $match)) {
        $labels[] = 'traefik.http.routers.'.$match[1].'.tls.options=velvet-tls12@file';
    }
}
$application->custom_labels = base64_encode(implode("\n", $labels));
$application->save();
$volume = App\Models\LocalPersistentVolume::firstOrCreate(
    ['resource_type' => App\Models\Application::class, 'resource_id' => $application->id, 'mount_path' => '/data'],
    ['name' => 'velvet-grimoire-members-data', 'host_path' => '/data/velvet-grimoire']
);
if ($volume->host_path !== '/data/velvet-grimoire') {
    throw new RuntimeException('Unexpected existing data mount.');
}
$deployment = (string) Illuminate\Support\Str::uuid();
$result = queue_application_deployment(application: $application->fresh(), deployment_uuid: $deployment, commit: $commit, is_api: true);
echo json_encode($result, JSON_THROW_ON_ERROR).PHP_EOL;
