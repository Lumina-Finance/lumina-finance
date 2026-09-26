<?php
// Creates the seed user in a fresh Firefly III and prints a personal access token for its API
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$repository = app(FireflyIII\Repositories\User\UserRepositoryInterface::class);
$user = FireflyIII\User::where('email', 'seed@example.com')->first()
    ?? $repository->store(['email' => 'seed@example.com', 'password' => bin2hex(random_bytes(16))]);
$repository->attachRole($user, 'owner');
echo $user->createToken('seed')->accessToken, PHP_EOL;
