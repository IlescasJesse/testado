-- CreateTable
CREATE TABLE `Empleado` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rfc` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NULL,

    UNIQUE INDEX `Empleado_rfc_key`(`rfc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Trimestre` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `anio` INTEGER NOT NULL,
    `periodo` INTEGER NOT NULL,

    UNIQUE INDEX `Trimestre_anio_periodo_key`(`anio`, `periodo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contrato` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empleadoId` INTEGER NOT NULL,
    `trimestreId` INTEGER NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `nombreArchivo` VARCHAR(191) NOT NULL,
    `rutaArchivo` VARCHAR(500) NOT NULL,
    `estado` ENUM('TESTADO', 'BLOQUEADO', 'DESBLOQUEADO', 'ERROR') NOT NULL DEFAULT 'TESTADO',
    `version` INTEGER NOT NULL DEFAULT 1,
    `rfcDetectado` VARCHAR(191) NULL,
    `fechaContrato` DATETIME(3) NULL,
    `procesadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `bloqueadoEn` DATETIME(3) NULL,
    `errorMsg` TEXT NULL,
    `eliminado` BOOLEAN NOT NULL DEFAULT false,

    INDEX `Contrato_hash_idx`(`hash`),
    UNIQUE INDEX `Contrato_empleadoId_trimestreId_version_key`(`empleadoId`, `trimestreId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Contrato` ADD CONSTRAINT `Contrato_empleadoId_fkey` FOREIGN KEY (`empleadoId`) REFERENCES `Empleado`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contrato` ADD CONSTRAINT `Contrato_trimestreId_fkey` FOREIGN KEY (`trimestreId`) REFERENCES `Trimestre`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
